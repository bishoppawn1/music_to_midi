#!/usr/bin/env python3
"""Download or read audio and transcribe it to a machine-readable notes file."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import tempfile
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Iterable, Sequence
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / "output" / "notes.json"
DEFAULT_TEMPO = 120.0
DEFAULT_CHANNEL = 0
DEFAULT_INSTRUMENT = 0  # General MIDI Acoustic Grand Piano
DEFAULT_VELOCITY = 100


class PipelineError(RuntimeError):
    """A user-actionable pipeline error."""


@dataclass(frozen=True)
class TranscriptionSettings:
    onset_threshold: float = 0.5
    frame_threshold: float = 0.3
    minimum_note_length_ms: float = 127.7
    minimum_frequency_hz: float | None = None
    maximum_frequency_hz: float | None = None


def midi_note_name(pitch: int) -> str:
    """Return a scientific-pitch name where MIDI 60 is C4."""
    if not 0 <= pitch <= 127:
        raise ValueError(f"MIDI pitch must be in 0..127; got {pitch}")
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    return f"{names[pitch % 12]}{pitch // 12 - 1}"


def is_youtube_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower().rstrip(".")
    return (
        parsed.scheme in {"http", "https"}
        and (
            host == "youtu.be"
            or host == "youtube.com"
            or host.endswith(".youtube.com")
            or host == "youtube-nocookie.com"
            or host.endswith(".youtube-nocookie.com")
        )
    )


def package_version(distribution: str) -> str | None:
    try:
        return version(distribution)
    except PackageNotFoundError:
        return None


def require_transcription_dependencies() -> None:
    missing = [name for name in ("basic-pitch", "librosa") if package_version(name) is None]
    if missing:
        joined = ", ".join(missing)
        raise PipelineError(
            f"Missing Python dependencies: {joined}. Run the uv sync command from "
            "stages/youtube_to_notes/README.md using Python 3.10."
        )


def require_download_dependencies() -> None:
    missing: list[str] = []
    if package_version("yt-dlp") is None:
        missing.append("yt-dlp (Python package)")
    for executable in ("ffmpeg", "ffprobe"):
        if shutil.which(executable) is None:
            missing.append(executable)
    if missing:
        raise PipelineError(
            "YouTube ingestion is missing: " + ", ".join(missing) + ". See the setup commands in "
            "stages/youtube_to_notes/README.md. Local audio ingestion does not require yt-dlp."
        )


def download_youtube_audio(url: str, work_dir: Path) -> tuple[Path, dict[str, Any]]:
    """Download one YouTube video's best audio and convert it to WAV."""
    if not is_youtube_url(url):
        raise PipelineError("--url must be an http(s) YouTube or youtu.be URL")
    require_download_dependencies()

    import yt_dlp  # type: ignore[import-not-found]

    work_dir.mkdir(parents=True, exist_ok=True)
    options: dict[str, Any] = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "outtmpl": str(work_dir / "%(id)s.%(ext)s"),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
        "restrictfilenames": True,
    }
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
    except Exception as exc:
        raise PipelineError(f"YouTube download failed: {exc}") from exc

    if info is None:
        raise PipelineError("yt-dlp returned no metadata")
    if "entries" in info:
        entries = [entry for entry in info.get("entries", []) if entry]
        if len(entries) != 1:
            raise PipelineError("Expected exactly one video, not a playlist")
        info = entries[0]

    video_id = str(info.get("id") or "")
    audio_path = work_dir / f"{video_id}.wav"
    if not video_id or not audio_path.is_file():
        candidates = sorted(work_dir.glob("*.wav"))
        if len(candidates) != 1:
            raise PipelineError("Could not identify the WAV file produced by yt-dlp/FFmpeg")
        audio_path = candidates[0]

    source = {
        "kind": "youtube",
        "url": info.get("webpage_url") or url,
        "id": info.get("id"),
        "title": info.get("title"),
        "uploader": info.get("uploader"),
        "duration_seconds": _optional_float(info.get("duration")),
    }
    return audio_path, source


def local_audio_source(audio_path: Path) -> dict[str, Any]:
    resolved = audio_path.expanduser().resolve()
    if not resolved.is_file():
        raise PipelineError(f"Audio file does not exist: {resolved}")
    return {"kind": "local_audio", "path": str(resolved), "title": resolved.stem}


def _optional_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def estimate_tempo(audio_path: Path) -> tuple[float, str, bool]:
    """Estimate one global BPM; use an explicit documented fallback if unavailable."""
    import librosa  # type: ignore[import-not-found]

    try:
        samples, sample_rate = librosa.load(str(audio_path), sr=22050, mono=True)
        tempo_result, _ = librosa.beat.beat_track(y=samples, sr=sample_rate)
        if hasattr(tempo_result, "flat"):
            tempo = float(tempo_result.flat[0])
        else:
            tempo = float(tempo_result)
        if math.isfinite(tempo) and tempo > 0:
            return tempo, "librosa.beat.beat_track", True
    except Exception:
        pass
    return DEFAULT_TEMPO, "default_fallback", False


def transcribe_note_events(
    audio_path: Path, settings: TranscriptionSettings
) -> Sequence[tuple[float, float, int, float, Sequence[int] | None]]:
    """Run Basic Pitch and return its note-event tuples."""
    from basic_pitch.inference import predict  # type: ignore[import-not-found]

    try:
        _, _, note_events = predict(
            str(audio_path),
            onset_threshold=settings.onset_threshold,
            frame_threshold=settings.frame_threshold,
            minimum_note_length=settings.minimum_note_length_ms,
            minimum_frequency=settings.minimum_frequency_hz,
            maximum_frequency=settings.maximum_frequency_hz,
            multiple_pitch_bends=False,
        )
    except Exception as exc:
        raise PipelineError(f"Audio transcription failed: {exc}") from exc
    return note_events


def normalize_note_events(
    note_events: Iterable[tuple[float, float, int, float, Sequence[int] | None]],
) -> list[dict[str, Any]]:
    """Convert Basic Pitch tuples to stable JSON events, sorted by onset and pitch."""
    normalized: list[dict[str, Any]] = []
    for start, end, pitch, amplitude, pitch_bend in note_events:
        pitch_int = int(pitch)
        start_value = max(0.0, float(start))
        duration = max(0.0, float(end) - start_value)
        velocity = max(1, min(127, int(round(float(amplitude) * 127))))
        event: dict[str, Any] = {
            "pitch": pitch_int,
            "name": midi_note_name(pitch_int),
            "start": round(start_value, 6),
            "duration": round(duration, 6),
            "velocity": velocity,
        }
        if pitch_bend:
            event["pitch_bend"] = [int(value) for value in pitch_bend]
        normalized.append(event)
    return sorted(normalized, key=lambda event: (event["start"], event["pitch"], event["duration"]))


def build_document(
    *,
    source: dict[str, Any],
    note_events: Iterable[tuple[float, float, int, float, Sequence[int] | None]],
    tempo: float,
    tempo_source: str,
    tempo_estimated: bool,
    settings: TranscriptionSettings,
) -> dict[str, Any]:
    notes = normalize_note_events(note_events)
    return {
        "schema_version": "1.0",
        "tempo": round(float(tempo), 6),
        "time_unit": "seconds",
        "channel": DEFAULT_CHANNEL,
        "instrument": DEFAULT_INSTRUMENT,
        "velocity": DEFAULT_VELOCITY,
        "notes": notes,
        "source": source,
        "tempo_metadata": {"source": tempo_source, "estimated": tempo_estimated},
        "render_defaults_metadata": {
            "channel_inferred": False,
            "instrument_inferred": False,
            "instrument_name": "Acoustic Grand Piano",
            "reason": "Basic Pitch is instrument-agnostic; these are MIDI rendering defaults.",
        },
        "transcription": {
            "engine": "basic-pitch",
            "engine_version": package_version("basic-pitch"),
            "polyphonic": True,
            "onset_threshold": settings.onset_threshold,
            "frame_threshold": settings.frame_threshold,
            "minimum_note_length_ms": settings.minimum_note_length_ms,
            "minimum_frequency_hz": settings.minimum_frequency_hz,
            "maximum_frequency_hz": settings.maximum_frequency_hz,
            "note_count": len(notes),
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def write_document(document: dict[str, Any], output_path: Path, *, force: bool) -> None:
    output_path = output_path.expanduser().resolve()
    if output_path.exists() and not force:
        raise PipelineError(f"Output already exists: {output_path}. Pass --force to replace it.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_name(f".{output_path.name}.tmp")
    temporary_path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary_path.replace(output_path)


def positive_float(value: str) -> float:
    result = float(value)
    if not math.isfinite(result) or result <= 0:
        raise argparse.ArgumentTypeError("must be a finite number greater than zero")
    return result


def probability(value: str) -> float:
    result = float(value)
    if not math.isfinite(result) or not 0.0 <= result <= 1.0:
        raise argparse.ArgumentTypeError("must be between 0 and 1")
    return result


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Transcribe a YouTube video or local audio file into output/notes.json."
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url", help="One YouTube video URL (playlists are disabled)")
    source.add_argument("--audio", type=Path, help="Local audio file, useful for tests and offline runs")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help=f"JSON destination (default: {DEFAULT_OUTPUT})")
    parser.add_argument("--tempo", type=positive_float, help="Known global BPM; otherwise BPM is estimated")
    parser.add_argument("--work-dir", type=Path, help="Keep downloaded/intermediate audio in this directory")
    parser.add_argument("--onset-threshold", type=probability, default=0.5)
    parser.add_argument("--frame-threshold", type=probability, default=0.3)
    parser.add_argument("--minimum-note-length-ms", type=positive_float, default=127.7)
    parser.add_argument("--minimum-frequency-hz", type=positive_float)
    parser.add_argument("--maximum-frequency-hz", type=positive_float)
    parser.add_argument("--force", action="store_true", help="Replace an existing output file")
    return parser


def run(args: argparse.Namespace) -> Path:
    settings = TranscriptionSettings(
        onset_threshold=args.onset_threshold,
        frame_threshold=args.frame_threshold,
        minimum_note_length_ms=args.minimum_note_length_ms,
        minimum_frequency_hz=args.minimum_frequency_hz,
        maximum_frequency_hz=args.maximum_frequency_hz,
    )
    if (
        settings.minimum_frequency_hz is not None
        and settings.maximum_frequency_hz is not None
        and settings.minimum_frequency_hz >= settings.maximum_frequency_hz
    ):
        raise PipelineError("--minimum-frequency-hz must be less than --maximum-frequency-hz")

    require_transcription_dependencies()
    if args.url:
        if args.work_dir:
            context = nullcontext(args.work_dir.expanduser().resolve())
        else:
            context = tempfile.TemporaryDirectory(prefix="youtube_to_notes-")
        with context as work_value:
            work_dir = Path(work_value)
            audio_path, source = download_youtube_audio(args.url, work_dir)
            return _transcribe_and_write(audio_path, source, settings, args)

    audio_path = args.audio.expanduser().resolve()
    source = local_audio_source(audio_path)
    return _transcribe_and_write(audio_path, source, settings, args)


def _transcribe_and_write(
    audio_path: Path,
    source: dict[str, Any],
    settings: TranscriptionSettings,
    args: argparse.Namespace,
) -> Path:
    note_events = transcribe_note_events(audio_path, settings)
    if args.tempo is not None:
        tempo, tempo_source, tempo_estimated = float(args.tempo), "user", False
    else:
        tempo, tempo_source, tempo_estimated = estimate_tempo(audio_path)
    document = build_document(
        source=source,
        note_events=note_events,
        tempo=tempo,
        tempo_source=tempo_source,
        tempo_estimated=tempo_estimated,
        settings=settings,
    )
    output_path = args.output.expanduser().resolve()
    write_document(document, output_path, force=args.force)
    return output_path


def main(argv: Sequence[str] | None = None) -> int:
    parser = make_parser()
    args = parser.parse_args(argv)
    try:
        output_path = run(args)
    except PipelineError as exc:
        parser.exit(2, f"error: {exc}\n")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
