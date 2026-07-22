# Link to MIDI web app

The hosted interface accepts one public YouTube link, streams its audio through
the application, transcribes it with Spotify Basic Pitch in the visitor's
browser, cleans likely duplicate retriggers, and produces a downloadable
Standard MIDI file.

End users do not install anything. They paste a link, wait for the five visible
processing steps, optionally preview the result, and download the MIDI.

## Development

```sh
npm install
npm run dev
npm test
```

The app supports public YouTube videos up to ten minutes. Automatic music
transcription is most accurate on recordings dominated by one instrument.
Only convert media you have permission to use.
