#!/usr/bin/env python3
"""Convert a JSON note transcription to a Standard MIDI File (format 0).

The default paths are relative to the repository root, not the caller's current
working directory, so this script can be invoked from anywhere.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import struct
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "output" / "notes.json"
DEFAULT_OUTPUT = ROOT / "output" / "transcription.mid"

NOTE_RE = re.compile(r"^([A-Ga-g])([#b]?)(-?\d+)$")
SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


class ConversionError(ValueError):
    """Raised when a transcription cannot be represented safely as MIDI."""


@dataclass(frozen=True)
class PreparedNote:
    pitch: int
    start_tick: int
    end_tick: int
    velocity: int
    channel: int
    instrument: int
    source_index: int


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConversionError(f"{label} must be a number")
    result = float(value)
    if not math.isfinite(result):
        raise ConversionError(f"{label} must be finite")
    return result


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConversionError(f"{label} must be an integer")
    if not minimum <= value <= maximum:
        raise ConversionError(f"{label} must be between {minimum} and {maximum}")
    return value


def note_name_to_midi(value: str) -> int:
    """Translate scientific pitch notation (C4 = MIDI 60) to a MIDI pitch."""
    match = NOTE_RE.fullmatch(value.strip())
    if not match:
        raise ConversionError(
            f"invalid note name {value!r}; expected scientific notation such as C4 or F#3"
        )
    letter, accidental, octave_text = match.groups()
    semitone = SEMITONES[letter.upper()]
    if accidental == "#":
        semitone += 1
    elif accidental == "b":
        semitone -= 1
    pitch = (int(octave_text) + 1) * 12 + semitone
    if not 0 <= pitch <= 127:
        raise ConversionError(f"note name {value!r} is outside the MIDI pitch range")
    return pitch


def _pitch(event: dict[str, Any], index: int) -> int:
    values = [event[key] for key in ("pitch", "pitch_midi", "note", "name", "note_name") if key in event]
    if not values:
        raise ConversionError(f"notes[{index}] is missing pitch/note/name")

    parsed: list[int] = []
    for value in values:
        if isinstance(value, str):
            parsed.append(note_name_to_midi(value))
        else:
            parsed.append(_integer(value, f"notes[{index}].pitch", 0, 127))
    if len(set(parsed)) != 1:
        raise ConversionError(f"notes[{index}] contains conflicting pitch fields")
    return parsed[0]


def _unit(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ConversionError(f"{label} must be 'seconds' or 'beats'")
    normalized = value.strip().lower()
    if normalized in {"second", "seconds", "sec", "s"}:
        return "seconds"
    if normalized in {"beat", "beats"}:
        return "beats"
    raise ConversionError(f"{label} must be 'seconds' or 'beats'")


def _timing(event: dict[str, Any], index: int, default_unit: str) -> tuple[float, float, str]:
    seconds_keys = {"start_seconds", "onset_seconds", "duration_seconds", "end_seconds"}
    beats_keys = {"start_beats", "onset_beats", "duration_beats", "end_beats"}
    has_seconds = any(key in event for key in seconds_keys)
    has_beats = any(key in event for key in beats_keys)
    if has_seconds and has_beats:
        raise ConversionError(f"notes[{index}] mixes explicit seconds and beats fields")

    if has_seconds:
        unit = "seconds"
        start_keys = ("start_seconds", "onset_seconds")
        duration_keys = ("duration_seconds", "duration", "length")
        end_keys = ("end_seconds", "end", "end_time", "offset")
    elif has_beats:
        unit = "beats"
        start_keys = ("start_beats", "onset_beats")
        duration_keys = ("duration_beats", "duration", "length")
        end_keys = ("end_beats", "end", "end_time", "offset")
    else:
        unit = _unit(event.get("time_unit", default_unit), f"notes[{index}].time_unit")
        start_keys = ("start", "start_time", "onset")
        duration_keys = ("duration", "length")
        end_keys = ("end", "end_time", "offset")

    present_starts = [(key, event[key]) for key in start_keys if key in event]
    if not present_starts:
        raise ConversionError(f"notes[{index}] is missing a start time")
    start = _number(present_starts[0][1], f"notes[{index}].{present_starts[0][0]}")
    for key, value in present_starts[1:]:
        if _number(value, f"notes[{index}].{key}") != start:
            raise ConversionError(f"notes[{index}] contains conflicting start fields")

    present_durations = [(key, event[key]) for key in duration_keys if key in event]
    present_ends = [(key, event[key]) for key in end_keys if key in event]
    if not present_durations and not present_ends:
        raise ConversionError(f"notes[{index}] is missing duration or end time")

    if present_durations:
        duration = _number(
            present_durations[0][1], f"notes[{index}].{present_durations[0][0]}"
        )
        for key, value in present_durations[1:]:
            if _number(value, f"notes[{index}].{key}") != duration:
                raise ConversionError(f"notes[{index}] contains conflicting duration fields")
    else:
        duration = _number(present_ends[0][1], f"notes[{index}].{present_ends[0][0]}") - start

    for key, value in present_ends:
        end = _number(value, f"notes[{index}].{key}")
        if not math.isclose(end, start + duration, rel_tol=1e-9, abs_tol=1e-9):
            raise ConversionError(f"notes[{index}] contains conflicting duration and end fields")
    if start < 0:
        raise ConversionError(f"notes[{index}] start time cannot be negative")
    if duration <= 0:
        raise ConversionError(f"notes[{index}] duration must be positive")
    return start, duration, unit


def _ticks(value: float, unit: str, tempo: float, ticks_per_beat: int) -> int:
    beats = value if unit == "beats" else value * tempo / 60.0
    return int(round(beats * ticks_per_beat))


def prepare_notes(document: dict[str, Any]) -> tuple[float, int, list[PreparedNote]]:
    """Validate and normalize a decoded notes document."""
    if not isinstance(document, dict):
        raise ConversionError("the JSON root must be an object")
    tempo_value = document.get("tempo", document.get("bpm", document.get("tempo_bpm")))
    if tempo_value is None:
        raise ConversionError("the JSON root is missing tempo (BPM)")
    tempo = _number(tempo_value, "tempo")
    if tempo <= 0:
        raise ConversionError("tempo must be positive")
    microseconds_per_quarter = round(60_000_000 / tempo)
    if not 1 <= microseconds_per_quarter <= 0xFFFFFF:
        raise ConversionError("tempo is outside the range representable by a MIDI tempo event")

    ticks_per_beat = _integer(document.get("ticks_per_beat", 480), "ticks_per_beat", 1, 0x7FFF)
    default_unit = _unit(document.get("time_unit", "seconds"), "time_unit")
    default_velocity = _integer(document.get("velocity", 96), "velocity", 1, 127)
    default_channel = _integer(document.get("channel", 0), "channel", 0, 15)
    default_instrument = _integer(document.get("instrument", 0), "instrument", 0, 127)

    raw_notes = document.get("notes")
    if not isinstance(raw_notes, list):
        raise ConversionError("notes must be an array")
    prepared: list[PreparedNote] = []
    for index, event in enumerate(raw_notes):
        if not isinstance(event, dict):
            raise ConversionError(f"notes[{index}] must be an object")
        start, duration, unit = _timing(event, index, default_unit)
        start_tick = _ticks(start, unit, tempo, ticks_per_beat)
        end_tick = _ticks(start + duration, unit, tempo, ticks_per_beat)
        if end_tick <= start_tick:
            end_tick = start_tick + 1
        prepared.append(
            PreparedNote(
                pitch=_pitch(event, index),
                start_tick=start_tick,
                end_tick=end_tick,
                velocity=_integer(
                    event.get("velocity", default_velocity), f"notes[{index}].velocity", 1, 127
                ),
                channel=_integer(
                    event.get("channel", default_channel), f"notes[{index}].channel", 0, 15
                ),
                instrument=_integer(
                    event.get("instrument", default_instrument),
                    f"notes[{index}].instrument",
                    0,
                    127,
                ),
                source_index=index,
            )
        )
    return tempo, ticks_per_beat, prepared


def _variable_length(value: int) -> bytes:
    if not 0 <= value <= 0x0FFFFFFF:
        raise ConversionError("a MIDI delta time exceeds the 28-bit variable-length limit")
    encoded = [value & 0x7F]
    value >>= 7
    while value:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(encoded))


def _validated_events(notes: list[PreparedNote]) -> list[tuple[int, int, int, bytes]]:
    """Build channel events while rejecting MIDI-unrepresentable overlaps."""
    starts: dict[int, list[PreparedNote]] = {}
    ends: dict[int, list[PreparedNote]] = {}
    for note in notes:
        starts.setdefault(note.start_tick, []).append(note)
        ends.setdefault(note.end_tick, []).append(note)

    active: dict[tuple[int, int], PreparedNote] = {}
    active_by_channel: dict[int, set[int]] = {}
    current_program: dict[int, int] = {}
    events: list[tuple[int, int, int, bytes]] = []

    for tick in sorted(set(starts) | set(ends)):
        for note in sorted(ends.get(tick, []), key=lambda item: item.source_index):
            active.pop((note.channel, note.pitch), None)
            active_by_channel.setdefault(note.channel, set()).discard(note.source_index)
            events.append((tick, 0, note.source_index, bytes((0x80 | note.channel, note.pitch, 0))))

        starting = starts.get(tick, [])
        by_channel: dict[int, list[PreparedNote]] = {}
        for note in starting:
            by_channel.setdefault(note.channel, []).append(note)
        for channel, channel_notes in by_channel.items():
            instruments = {note.instrument for note in channel_notes}
            if len(instruments) > 1:
                indices = ", ".join(str(note.source_index) for note in channel_notes)
                raise ConversionError(
                    f"notes [{indices}] start together on channel {channel} with different instruments"
                )
            requested = next(iter(instruments))
            active_indices = active_by_channel.get(channel, set())
            if active_indices:
                active_instruments = {notes[index].instrument for index in active_indices}
                if requested not in active_instruments:
                    raise ConversionError(
                        f"notes[{channel_notes[0].source_index}] changes instrument on channel "
                        f"{channel} while another note is sounding; use a different channel"
                    )
            if current_program.get(channel) != requested:
                serial = min(note.source_index for note in channel_notes)
                events.append((tick, 1, serial, bytes((0xC0 | channel, requested))))
                current_program[channel] = requested

        for note in sorted(starting, key=lambda item: item.source_index):
            key = (note.channel, note.pitch)
            if key in active:
                previous = active[key]
                raise ConversionError(
                    f"notes[{note.source_index}] overlaps notes[{previous.source_index}] with the "
                    f"same pitch and channel, which MIDI cannot represent unambiguously"
                )
            active[key] = note
            active_by_channel.setdefault(note.channel, set()).add(note.source_index)
            events.append(
                (tick, 2, note.source_index, bytes((0x90 | note.channel, note.pitch, note.velocity)))
            )
    return events


def build_midi(document: dict[str, Any]) -> tuple[bytes, int]:
    """Return encoded MIDI bytes and the number of encoded notes."""
    tempo, ticks_per_beat, notes = prepare_notes(document)
    microseconds_per_quarter = round(60_000_000 / tempo)
    tempo_bytes = microseconds_per_quarter.to_bytes(3, "big")
    events = [(0, -10, -1, b"\xff\x51\x03" + tempo_bytes)]
    events.extend(_validated_events(notes))
    events.sort(key=lambda item: (item[0], item[1], item[2]))

    track = bytearray()
    previous_tick = 0
    for tick, _priority, _serial, payload in events:
        track.extend(_variable_length(tick - previous_tick))
        track.extend(payload)
        previous_tick = tick
    track.extend(b"\x00\xff\x2f\x00")

    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, ticks_per_beat)
    track_chunk = b"MTrk" + struct.pack(">I", len(track)) + bytes(track)
    return header + track_chunk, len(notes)


def convert_file(input_path: Path, output_path: Path) -> int:
    """Convert one JSON file atomically, returning its encoded note count."""
    try:
        with input_path.open("r", encoding="utf-8") as source:
            document = json.load(source)
    except FileNotFoundError as exc:
        raise ConversionError(f"input file does not exist: {input_path}") from exc
    except json.JSONDecodeError as exc:
        raise ConversionError(
            f"invalid JSON in {input_path} at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc

    midi, note_count = build_midi(document)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=output_path.parent, prefix=f".{output_path.name}.", delete=False
        ) as temporary:
            temporary_name = temporary.name
            temporary.write(midi)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, output_path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return note_count


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="input notes JSON path")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="output MIDI path")
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        count = convert_file(args.input.expanduser().resolve(), args.output.expanduser().resolve())
    except (ConversionError, OSError) as exc:
        print(f"error: {exc}", file=__import__("sys").stderr)
        return 2
    print(f"Wrote {count} notes to {args.output.expanduser().resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
