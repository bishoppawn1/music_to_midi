# Link to MIDI web app

The hosted interface accepts one public YouTube link, streams its audio through
the application, transcribes it with Spotify Basic Pitch in the visitor's
browser, cleans likely duplicate retriggers, and produces a downloadable
Standard MIDI file.

End users do not install anything. They paste a link, wait for the five visible
processing steps, optionally preview the result, and download the MIDI.

## Deployment

The visitor-facing application is built into the repository root for GitHub
Pages:

```sh
npm run build:pages
```

The `/api/audio` route required for YouTube links deploys to Cloudflare
Workers. It is not configured as a ChatGPT Site. Set `VITE_AUDIO_API_ORIGIN` to
that Worker's origin when building the Pages application.

After authenticating the maintainer's Cloudflare account, deploy with:

```sh
npm run deploy:cloudflare
```

This setup work is only for the maintainer. Visitors still need only a browser
and a YouTube link.

## Development

```sh
npm install
npm run dev
npm test
```

The app supports public YouTube videos up to ten minutes. Automatic music
transcription is most accurate on recordings dominated by one instrument.
Only convert media you have permission to use.
