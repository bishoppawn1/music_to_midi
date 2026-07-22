#!/usr/bin/env python3
"""Validate and play Standard MIDI files without third-party Python packages."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shlex
import shutil
import struct
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MIDI = ROOT / "output" / "transcription.mid"
SWIFT_PLAYER = Path(__file__).with_name("play_midi.swift")


class MidiValidationError(ValueError):
    pass


def validate_midi(path: Path) -> tuple[int, int, str]:
    """Return (format, track count, timing description) for a structural SMF."""
    try:
        data = path.read_bytes()
    except FileNotFoundError as exc:
        raise MidiValidationError(f"MIDI file not found: {path}") from exc
    except OSError as exc:
        raise MidiValidationError(f"Cannot read MIDI file {path}: {exc}") from exc

    if len(data) < 14 or data[:4] != b"MThd":
        raise MidiValidationError(f"Not a Standard MIDI file (missing MThd header): {path}")

    header_length = struct.unpack_from(">I", data, 4)[0]
    if header_length < 6 or 8 + header_length > len(data):
        raise MidiValidationError("Invalid or truncated MThd chunk")

    midi_format, declared_tracks, division = struct.unpack_from(">HHH", data, 8)
    if midi_format > 2:
        raise MidiValidationError(f"Unsupported MIDI format: {midi_format}")
    if declared_tracks == 0:
        raise MidiValidationError("MIDI file declares zero tracks")
    if midi_format == 0 and declared_tracks != 1:
        raise MidiValidationError("Format-0 MIDI must declare exactly one track")
    if division == 0:
        raise MidiValidationError("MIDI timing division cannot be zero")

    offset = 8 + header_length
    actual_tracks = 0
    while offset < len(data):
        if offset + 8 > len(data):
            raise MidiValidationError("Truncated MIDI chunk header")
        chunk_type = data[offset : offset + 4]
        chunk_length = struct.unpack_from(">I", data, offset + 4)[0]
        offset += 8
        if offset + chunk_length > len(data):
            raise MidiValidationError("Truncated MIDI chunk data")
        if chunk_type == b"MTrk":
            actual_tracks += 1
        offset += chunk_length

    if actual_tracks != declared_tracks:
        raise MidiValidationError(
            f"Track count mismatch: header declares {declared_tracks}, found {actual_tracks}"
        )

    if division & 0x8000:
        frames = 256 - ((division >> 8) & 0xFF)
        ticks = division & 0xFF
        if ticks == 0:
            raise MidiValidationError("SMPTE ticks per frame cannot be zero")
        timing = f"SMPTE {frames} fps, {ticks} ticks/frame"
    else:
        timing = f"{division} ticks/quarter-note"
    return midi_format, declared_tracks, timing


def executable(candidates: list[str]) -> str | None:
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
        path = Path(candidate).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    return None


def find_soundfont(requested: Path | None) -> Path | None:
    if requested:
        resolved = requested.expanduser().resolve()
        if not resolved.is_file():
            raise MidiValidationError(f"SoundFont not found: {resolved}")
        return resolved
    for candidate in (
        "/usr/share/sounds/sf2/FluidR3_GM.sf2",
        "/usr/share/soundfonts/default.sf2",
        "/usr/share/sounds/sf2/default-GM.sf2",
    ):
        if Path(candidate).is_file():
            return Path(candidate)
    return None


def player_commands(midi: Path, soundfont: Path | None) -> dict[str, list[str]]:
    commands: dict[str, list[str]] = {}
    if sys.platform == "darwin":
        swift = executable(["swift"])
        if swift and SWIFT_PLAYER.is_file():
            commands["avfoundation"] = [swift, str(SWIFT_PLAYER), str(midi)]

    timidity = executable(["timidity", "timidity++"])
    if timidity:
        commands["timidity"] = [timidity, str(midi)]

    fluidsynth = executable(["fluidsynth"])
    if fluidsynth and soundfont:
        commands["fluidsynth"] = [fluidsynth, "-i", str(soundfont), str(midi)]

    vlc = executable(
        [
            "vlc",
            "/Applications/VLC.app/Contents/MacOS/VLC",
            "C:/Program Files/VideoLAN/VLC/vlc.exe",
            "C:/Program Files (x86)/VideoLAN/VLC/vlc.exe",
        ]
    )
    if vlc:
        commands["vlc"] = [vlc, "--intf", "dummy", "--no-video", "--play-and-exit", str(midi)]
    return commands


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate and play a Standard MIDI file.")
    parser.add_argument(
        "midi",
        nargs="?",
        type=Path,
        default=DEFAULT_MIDI,
        help=f"MIDI path (default: {DEFAULT_MIDI})",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate the file and exit without selecting or starting a player",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate the file and print the selected playback command without running it",
    )
    parser.add_argument(
        "--player",
        choices=("auto", "avfoundation", "timidity", "fluidsynth", "vlc"),
        default="auto",
        help="player backend (default: auto)",
    )
    parser.add_argument(
        "--soundfont",
        type=Path,
        help=".sf2/.sf3 file required by FluidSynth (common Linux paths are auto-detected)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    midi = args.midi.expanduser().resolve()
    try:
        midi_format, tracks, timing = validate_midi(midi)
        soundfont = find_soundfont(args.soundfont)
    except MidiValidationError as exc:
        print(exc, file=sys.stderr)
        return 2

    print(f"Valid Standard MIDI: format {midi_format}, {tracks} track(s), {timing}")
    if args.check:
        return 0

    commands = player_commands(midi, soundfont)
    preference = (
        ("avfoundation", "timidity", "fluidsynth", "vlc")
        if sys.platform == "darwin"
        else ("timidity", "fluidsynth", "vlc")
    )
    selected = args.player
    if selected == "auto":
        selected = next((name for name in preference if name in commands), "")
    if not selected or selected not in commands:
        detail = ""
        if args.player == "fluidsynth" and not soundfont:
            detail = " FluidSynth also requires --soundfont /path/to/bank.sf2."
        print(f"Playback backend '{args.player}' is not available.{detail}", file=sys.stderr)
        return 69

    command = commands[selected]
    print(f"Selected player: {selected}")
    if args.dry_run:
        print(f"Command: {shlex.join(command)}")
        return 0

    try:
        return subprocess.run(command, check=False).returncode
    except KeyboardInterrupt:
        return 130
    except OSError as exc:
        print(f"Could not start {selected}: {exc}", file=sys.stderr)
        return 69


if __name__ == "__main__":
    raise SystemExit(main())
