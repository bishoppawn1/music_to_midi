import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages root is the converter application", async () => {
  const root = new URL("../../", import.meta.url);
  const [html, page, settings, noteOrder, filename, playback, packageJson, assets] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/detection-settings.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/note-order.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/download-filename.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/playback-levels.ts", import.meta.url), "utf8"),
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
  assert.match(page, /Pitch focus/);
  assert.match(page, /useState<SensitivityId>\("balanced"\)/);
  assert.match(page, /recoverPitchEdges\(frames, pitchRange\)/);
  assert.match(page, /Note direction/);
  assert.match(page, /applyNoteDirection\(cleaned\.notes, noteDirection\)/);
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
  assert.match(page, /midiVelocity\(note\.amplitude\)/);
  assert.match(page, /previewNoteGain\(note\.amplitude\)/);
  assert.match(playback, /PREVIEW_MASTER_GAIN = 0\.9/);
  assert.match(playback, /return 0\.62 \+/);
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
