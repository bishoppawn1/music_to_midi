# Link to MIDI web app

The GitHub Pages interface accepts one YouTube link, embeds its player, captures
audio from that same tab after the visitor grants browser permission,
transcribes it with Spotify Basic Pitch, cleans likely duplicate retriggers,
and produces a downloadable Standard MIDI file.

End users do not install anything or create an account. They:

1. Paste a YouTube link and load the embedded player.
2. Pause the player at the desired start.
3. Click **Capture this tab**.
4. Select the current Link to MIDI tab and enable **Share tab audio**.
5. Play the embedded video, then click **Stop and make MIDI**.
6. Preview, seek through, correct, and download the result. The MIDI filename
   includes the download's local date and time, such as
   `youtube-capture-2026-07-23_02-45-07.mid`.

The player, captured audio, and transcription stay in one browser tab. If a
video owner has disabled embedding, the interface provides a link to open that
video directly on YouTube and use the two-tab fallback.

**Detection detail** controls how readily quieter and shorter notes are kept.
The default **Balanced** profile recovers substantially more short notes than
the original settings without accepting every weak activation. Choose **More
notes** for particularly quiet or fast performances. **Pitch focus** can limit
detection to the low, middle, or high register when sounds outside the
instrument's range are creating unwanted notes. The default **Wide · A0–C8**
mode applies a gradual confidence boost to the lowest and highest model octaves
so quiet bass and treble notes are less likely to be dropped. A0–C8 is the
Basic Pitch model's fixed output range.

Every inference is decoded three ways: strict, selected, and sensitive.
Detections found by multiple passes receive consensus support, while isolated
weak activations need stronger onset or audio-attack evidence. **Transcription
mode** can follow one dominant melody, retain polyphonic chords, or choose
automatically. A conservative post-pass removes weak octave and harmonic
shadows without discarding strong chord tones. Edge recovery is gentler for
onsets than sustained frames so it recovers range extremes without creating as
many false attacks.

**Instrument setup** adds musical-role separation and a physical plausibility
pass after those confidence checks. Automatic mode keeps an ordinary chordal
performance on one piano track, but separates an independently moving
monophonic lead from chordal accompaniment when the note patterns clearly
differ. Because Basic Pitch does not identify timbre, automatic mode labels that
part as a generic Solo lead. A visitor who knows the source instrumentation can
choose an exact two-track setup such as **Piano + trumpet** or **Piano + bass**.
Those choices assign every detected note to exactly one instrument and write
separate General MIDI tracks, programs, and channels.

Single-instrument choices remain available for Voice / solo, Bass, Guitar,
Piano / keys, and Ensemble. Each track is cleaned against its own realistic
simultaneous-note target and hard physical ceiling: piano targets about six
notes and cannot retain more than ten, while guitar cannot retain more than
six. Notes above the usual target survive only when they have both a strong
onset and agreement across decoding passes. If a valid held note becomes
implausible only when a later chord begins, it is shortened at that chord rather
than deleted from its earlier, valid passage.

The interface explains the three modes in plain language:

- **Automatic** listens first and chooses for the visitor.
- **Melody** is for one main tune, such as singing, whistling, flute, or a solo.
- **Chords** is for several notes at once, such as piano chords or strummed
  guitar.

Before inference, stereo channels are checked for phase cancellation, converted
to the cleanest mono representation, normalized, and resampled locally. The
output retains Basic Pitch contour data: melody MIDI uses per-note pitch bends,
while chord MIDI uses the estimated global tuning offset because MIDI pitch
bends affect an entire channel.

**Note direction** can leave timing in its original order or mirror the detected
phrase from last note to first. Reverse mode affects the in-browser preview and
the downloaded MIDI while preserving chords, note lengths, dynamics, and the
phrase's overall duration. YouTube's embedded player itself does not expose
reverse video playback.

Preview playback uses a high-output gain curve with compression to keep both
single notes and dense chords clearly audible. Downloaded MIDI notes also use a
stronger velocity range while retaining the relative dynamics detected from the
source performance.

The result includes a seekable preview timeline and a lightweight piano-roll
correction view. A visitor can jump to any point, select and transpose a note,
delete a false note, add a missing note at the playhead, or move a selected note
to the next detected instrument track. Track colors and preview waveforms make
the assignments distinguishable before download. Each correction immediately
regenerates the multi-track MIDI in the browser.

The preview speed control ranges from **0.1×** to **4.0×** in 0.1× steps. Speed
changes take effect while the preview is playing, and the playhead continues to
show the correct position in the song. This only changes the browser preview;
the downloaded MIDI keeps its original timing.

To reduce stutter, fragments of the same pitch are joined across short gaps only
when the waveform has no fresh attack and the model does not strongly identify
a new note. Pitch contours use a small median smoother, and the preview
schedules twelve seconds at a time instead of creating every oscillator for the
whole recording at once.

Whenever two detected fragments are joined, the surviving note begins at the
earliest fragment start and ends at the latest fragment end. The merge therefore
keeps the full held-note length instead of shortening the sound.

## Deployment

The visitor-facing application is built into the repository root for GitHub
Pages:

```sh
npm run build:pages
```

There is no Cloudflare Worker, ChatGPT Site, or other application backend.
Hashed files in `site-assets/` are intentionally retained across deployments
so visitors with an already-open page can still load its deferred transcription
and MIDI modules after a newer version is published.

## Development

```sh
npm install
npm run dev
npm test
```

The app captures up to ten minutes at a time. Tab-audio sharing support varies
by browser, so a current desktop browser is recommended. Automatic music
transcription is most accurate on recordings dominated by one instrument. Only
capture media you have permission to use.
