# Notes to MIDI

`scripts/notes_to_midi.py` converts `output/notes.json` into a format-0 Standard
MIDI File at `output/transcription.mid`. It uses only the Python 3 standard
library, so there are no packages to install.

Run it from any directory:

```sh
python3 /Users/bishophall/_code/music/scripts/notes_to_midi.py
```

Override either path when needed:

```sh
python3 /Users/bishophall/_code/music/scripts/notes_to_midi.py \
  --input /path/to/notes.json \
  --output /path/to/transcription.mid
```

## Input contract

The preferred handoff schema is:

```json
{
  "tempo": 120,
  "time_unit": "seconds",
  "ticks_per_beat": 480,
  "channel": 0,
  "instrument": 0,
  "velocity": 96,
  "notes": [
    {
      "pitch": 60,
      "name": "C4",
      "start": 0.0,
      "duration": 0.5,
      "velocity": 100
    }
  ]
}
```

- `tempo` is BPM and is required. `bpm` and `tempo_bpm` are accepted aliases.
- `time_unit` is `seconds` (the default) or `beats`.
- `pitch` can be MIDI pitch `0`–`127` or a scientific note name such as `C4`,
  `F#3`, or `Db5`. `pitch_midi`, `note`, `name`, and `note_name` are aliases.
  If more than one pitch field is present, all must identify the same pitch.
- A note needs a nonnegative start and positive duration. Explicit pairs such as
  `start_seconds`/`duration_seconds` and `start_beats`/`duration_beats` are also
  accepted. `end` fields may replace duration.
- `velocity` is `1`–`127`, `channel` is zero-based `0`–`15`, and `instrument`
  is a General MIDI program number `0`–`127`. These can be defaults at the root
  or per-note overrides.
- Extra transcription/source metadata is ignored.

MIDI cannot independently express overlapping instances of the same pitch on
one channel, or switch a channel's instrument while a note is sustained. The
converter rejects those cases with a useful error; assign different channels
when separate instruments need to overlap.

## Tests

```sh
python3 -m unittest discover -s /Users/bishophall/_code/music/tests -v
```
