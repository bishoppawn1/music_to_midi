# MIDI playback

The player defaults to `output/transcription.mid`. It validates the Standard
MIDI container before invoking any audio program.

```sh
./play_midi.sh --check
./play_midi.sh --dry-run
./play_midi.sh
./play_midi.sh path/to/another.mid
```

`--check` performs validation only. `--dry-run` also selects a player and shows
the exact command, but does not start it. These modes do not claim that audio
reached the speakers.

On macOS, automatic selection prefers the built-in AVFoundation MIDI synth and
requires `python3` plus `swift` (included with Xcode Command Line Tools). On
Linux and other platforms, the CLI looks for TiMidity++, FluidSynth, then VLC.
FluidSynth requires a General MIDI SoundFont; pass one with
`--soundfont /path/to/bank.sf2` if it is not in a common Linux location. VLC's
ability to decode MIDI depends on how that VLC build was packaged.

Force an installed backend with `--player avfoundation`, `--player timidity`,
`--player fluidsynth`, or `--player vlc`.

Run the dependency-free validation tests with:

```sh
python3 -m unittest discover -s tests -v
```
