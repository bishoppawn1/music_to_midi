# YouTube/local audio to notes

This stage accepts either one YouTube video URL or an existing local audio file, transcribes polyphonic note events with Spotify Basic Pitch, estimates one global tempo with librosa, and writes `output/notes.json` for the notes-to-MIDI stage.

Only download content you are authorized to access. Playlists are deliberately disabled.

## Setup

Basic Pitch documents Python 3.10 as the supported version for Apple Silicon. From the repository root:

```sh
brew install ffmpeg
uv sync --project stages/youtube_to_notes --python 3.10
```

`ffmpeg` and `ffprobe` are needed only for YouTube ingestion. The Python dependencies are needed for both URL and local-file transcription.
The dependency set includes `setuptools<81` because Basic Pitch's `resampy` dependency still imports the legacy `pkg_resources` module.

## Run

No source URL has been provided yet. Once the actual URL is known:

```sh
uv run --project stages/youtube_to_notes --python 3.10 \
  python stages/youtube_to_notes/youtube_to_notes.py \
  --url 'ACTUAL_YOUTUBE_URL'
```

For a local audio test:

```sh
uv run --project stages/youtube_to_notes --python 3.10 \
  python stages/youtube_to_notes/youtube_to_notes.py \
  --audio /absolute/path/to/audio.wav
```

Use `--tempo 120` when the tempo is known. Otherwise the script estimates a single global BPM. Use `--work-dir output/source_audio` to retain downloaded/intermediate WAV audio. Existing JSON is protected unless `--force` is passed.

## Handoff schema

The canonical file is `output/notes.json`. Its compatibility-critical fields are:

```json
{
  "schema_version": "1.0",
  "tempo": 120.0,
  "time_unit": "seconds",
  "channel": 0,
  "instrument": 0,
  "velocity": 100,
  "notes": [
    {
      "pitch": 60,
      "name": "C4",
      "start": 0.0,
      "duration": 0.5,
      "velocity": 96
    }
  ]
}
```

`pitch` is MIDI pitch 0–127; `start` and `duration` are seconds; velocities are 1–127. Overlapping notes are allowed. `channel: 0` and General MIDI `instrument: 0` are rendering defaults, not claims about the source audio. `tempo_metadata`, `render_defaults_metadata`, `source`, and `transcription` record provenance and inference details. The complete machine-readable contract is `output/notes.schema.json`.

Basic Pitch is instrument-agnostic and works best when the recording contains one instrument, even though that instrument may be polyphonic. Dense full mixes will generally need human cleanup.

## Safe tests

The unit tests exercise URL validation, MIDI naming, Basic Pitch event normalization, schema construction, and overwrite protection without downloading media or loading the ML model:

```sh
python3 -m unittest discover -s stages/youtube_to_notes/tests -v
```
