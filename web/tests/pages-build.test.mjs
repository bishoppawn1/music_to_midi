import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages root is the converter application", async () => {
  const root = new URL("../../", import.meta.url);
  const [
    html,
    page,
    settings,
    noteOrder,
    filename,
    playback,
    accuracy,
    preprocessing,
    timeline,
    editing,
    cleanup,
    instrumentPolyphony,
    instrumentArrangement,
    midiOutput,
    sensitivityVersions,
    packageJson,
    assets,
  ] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/detection-settings.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/note-order.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/download-filename.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/playback-levels.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/transcription-accuracy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/audio-preprocessing.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/preview-timeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/note-editing.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/note-cleanup.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/instrument-polyphony.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/instrument-arrangement.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/midi-output.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sensitivity-versions.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readdir(new URL("site-assets/", root)),
  ]);

  assert.match(html, /<title>Link to MIDI/);
  assert.match(html, /site-assets\/app-[\w-]+\.js/);
  assert.doesNotMatch(html, /Audio-to-MIDI pipeline/);
  assert.match(page, /getDisplayMedia/);
  assert.match(page, /MediaRecorder/);
  assert.match(page, /Share tab audio/);
  assert.match(page, /youtube\.com\/embed/);
  assert.match(page, /preferCurrentTab:\s*true/);
  assert.match(page, /selfBrowserSurface:\s*"include"/);
  assert.match(page, /suppressLocalAudioPlayback:\s*false/);
  assert.match(page, /Detection detail/);
  assert.match(page, /DETECTION DETAIL VERSIONS/);
  assert.match(page, /Switch versions from this same capture/);
  assert.match(page, /Instruments are\s+assigned automatically in each version/);
  assert.match(page, /SENSITIVITY_OPTIONS\.map\(async/);
  assert.match(page, /showSensitivityVersion/);
  assert.match(page, /result\.variants\[option\.id\]\.notes\.length/);
  assert.match(sensitivityVersions, /activateSensitivityVersion/);
  assert.match(sensitivityVersions, /sensitivityVersionUrls/);
  assert.match(page, /Pitch focus/);
  assert.match(page, /useState<SensitivityId>\("balanced"\)/);
  assert.match(page, /recoverPitchEdges\(frames, pitchRange, 1\.2\)/);
  assert.match(page, /recoverPitchEdges\(onsets, pitchRange, 1\.08\)/);
  assert.match(page, /Note direction/);
  assert.match(page, /Transcription mode/);
  assert.doesNotMatch(page, /Instrument setup/);
  assert.match(page, /What do these music modes mean\?/);
  assert.match(page, /applyNoteDirection\(cleanedNotes, noteDirection\)/);
  assert.match(page, /fuseAdaptivePasses\(passes\)/);
  assert.match(page, /keepConfidentCandidates/);
  assert.match(page, /applyTranscriptionMode/);
  assert.match(page, /applyInstrumentPolyphony/);
  assert.match(page, /arrangeInstrumentTracks/);
  assert.match(page, /makeMultiTrackMidi/);
  assert.match(page, /previewWaveform/);
  assert.match(page, /data-instrument/);
  assert.match(page, /prepareAudioChannels/);
  assert.match(midiOutput, /pitchBendToMidiValue/);
  assert.match(page, /aria-label="Preview position"/);
  assert.match(page, /aria-label="Preview playback speed"/);
  assert.match(page, /Decrease preview speed/);
  assert.match(page, /Increase preview speed/);
  assert.match(page, /Add at playhead/);
  assert.match(page, /Next instrument/);
  assert.match(page, /scheduleWindow\(offset, scheduledThrough, true\)/);
  assert.match(page, /linearRampToValueAtTime/);
  assert.match(page, /onClick=\{\(event\) =>/);
  assert.match(page, /event\.currentTarget\.download = makeDownloadFilename/);
  assert.match(settings, /onsetThreshold:\s*0\.28/);
  assert.match(settings, /minNoteFrames:\s*3/);
  assert.match(settings, /Wide · A0–C8/);
  assert.match(noteOrder, /Reverse · last to first/);
  assert.match(filename, /date\.getFullYear\(\)/);
  assert.match(filename, /date\.getHours\(\)/);
  assert.match(filename, /\.mid/);
  assert.match(page, /compressor\.ratio\.value = 8/);
  assert.match(midiOutput, /midiVelocity\(note\.amplitude\)/);
  assert.match(page, /previewNoteGain\(note\.amplitude\)/);
  assert.match(playback, /PREVIEW_MASTER_GAIN = 0\.9/);
  assert.match(playback, /return 0\.62 \+/);
  assert.match(accuracy, /Melody · one main tune/);
  assert.match(accuracy, /Chords · notes together/);
  assert.match(accuracy, /smoothPitchBends/);
  assert.match(accuracy, /suppressWeakHarmonics/);
  assert.match(accuracy, /adaptiveDecodeSettings/);
  assert.match(preprocessing, /chooseMonoSignal/);
  assert.match(preprocessing, /normalizeSignal/);
  assert.match(timeline, /playableNotesFrom/);
  assert.match(timeline, /MIN_PREVIEW_SPEED = 0\.1/);
  assert.match(timeline, /MAX_PREVIEW_SPEED = 4/);
  assert.match(editing, /transposeNote/);
  assert.match(editing, /deleteNote/);
  assert.match(cleanup, /mergeNoteSpans/);
  assert.match(cleanup, /endTimeSeconds - startTimeSeconds/);
  assert.match(instrumentPolyphony, /Piano \/ keys · about 6, max 10/);
  assert.match(instrumentPolyphony, /maximumPolyphony/);
  assert.doesNotMatch(instrumentArrangement, /piano-trumpet|piano-bass/);
  assert.match(instrumentArrangement, /summarizeTimbre/);
  assert.match(instrumentArrangement, /classifyLikelyInstrument/);
  assert.match(instrumentArrangement, /midiProgram:\s*56/);
  assert.match(midiOutput, /notesByInstrument/);
  assert.match(midiOutput, /track\.instrument\.number/);
  assert.match(midiOutput, /track\.channel/);
  assert.doesNotMatch(page, /window\.open/);
  assert.doesNotMatch(page, /\/api\/audio|VITE_AUDIO_API_ORIGIN/);
  assert.doesNotMatch(packageJson, /cloudflare|wrangler|youtubei\.js|vinext/);
  assert.doesNotMatch(packageJson, /clean-pages-assets/);

  await Promise.all([
    access(new URL(".nojekyll", root)),
    access(new URL("model/model.json", root)),
  ]);
  assert.ok(assets.some((asset) => /^app-[\w-]+\.js$/.test(asset)));
  assert.ok(
    assets.filter((asset) => /^esm-[\w-]+\.js$/.test(asset)).length >= 2,
    "at least one prior deferred module must remain for already-open pages",
  );
});
