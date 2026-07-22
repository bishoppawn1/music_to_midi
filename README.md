# Audio-to-MIDI pipeline

This project implements three independent stages with explicit file handoffs:

1. `stages/youtube_to_notes/youtube_to_notes.py` downloads one authorized
   YouTube video's audio (or reads a local audio file), detects note events,
   and writes `output/notes.json`.
2. `scripts/notes_to_midi.py` converts that JSON into the format-0 Standard
   MIDI file `output/transcription.mid`.
3. `play_midi.sh` validates and plays the MIDI. On macOS it prefers the native
   AVFoundation synthesizer.

The canonical notes contract is [output/notes.schema.json](output/notes.schema.json).

## Install the transcription stage

The converter and validator use only Python's standard library. Audio
transcription uses Basic Pitch in a Python 3.10 environment; YouTube ingestion
also needs `ffmpeg`, `ffprobe`, and `yt-dlp`.

```sh
brew install ffmpeg
uv sync --project stages/youtube_to_notes --python 3.10
```

Only download media you are authorized to access.

## Run the stages

From this directory, create the note handoff from a YouTube URL:

```sh
uv run --project stages/youtube_to_notes --python 3.10 \
  python stages/youtube_to_notes/youtube_to_notes.py \
  --url 'YOUTUBE_URL'
```

For an offline/local source, replace the last line with
`--audio /absolute/path/to/audio.wav`. Add `--tempo 120` when the BPM is known,
or let the stage estimate one global tempo.

Then convert, validate, and play:

```sh
python3 scripts/notes_to_midi.py
./play_midi.sh --check
./play_midi.sh
```

Use `./play_midi.sh --dry-run` to show the selected playback command without
starting it. Generated output is protected from accidental replacement;
rerun the transcription stage with `--force` when replacement is intentional.

## Test without downloading or loading the ML model

```sh
python3 -m unittest discover -s stages/youtube_to_notes/tests -v
python3 -m unittest discover -s tests -v
swiftc -typecheck scripts/play_midi.swift
```

The root suite includes an integration test that turns mocked transcription
events into the shared JSON document, converts them to MIDI, and validates the
result through the playback stage.

Stage-specific details are in
[stages/youtube_to_notes/README.md](stages/youtube_to_notes/README.md),
[NOTES_TO_MIDI.md](NOTES_TO_MIDI.md), and [PLAYBACK.md](PLAYBACK.md).

