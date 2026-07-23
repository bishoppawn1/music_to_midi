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
6. Preview and download the result. The MIDI filename includes the download's
   local date and time, such as `youtube-capture-2026-07-23_02-45-07.mid`.

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

**Note direction** can leave timing in its original order or mirror the detected
phrase from last note to first. Reverse mode affects the in-browser preview and
the downloaded MIDI while preserving chords, note lengths, dynamics, and the
phrase's overall duration. YouTube's embedded player itself does not expose
reverse video playback.

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
