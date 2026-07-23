# Link to MIDI web app

The GitHub Pages interface accepts one YouTube link, opens the video, captures
audio from the tab after the visitor grants browser permission, transcribes it
with Spotify Basic Pitch, cleans likely duplicate retriggers, and produces a
downloadable Standard MIDI file.

End users do not install anything or create an account. They:

1. Paste a YouTube link and open the video.
2. Pause the video at the desired start.
3. Return to Link to MIDI and click **Capture tab audio**.
4. Select the YouTube tab and enable **Share tab audio**.
5. Play the desired section, then click **Stop and make MIDI**.
6. Preview and download the result.

The captured audio and transcription stay in the browser.

## Deployment

The visitor-facing application is built into the repository root for GitHub
Pages:

```sh
npm run build:pages
```

There is no Cloudflare Worker, ChatGPT Site, or other application backend.

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
