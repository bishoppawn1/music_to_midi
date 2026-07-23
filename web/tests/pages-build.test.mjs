import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages root is the converter application", async () => {
  const root = new URL("../../", import.meta.url);
  const html = await readFile(new URL("index.html", root), "utf8");

  assert.match(html, /<title>Link to MIDI/);
  assert.match(html, /site-assets\/app\.js/);
  assert.doesNotMatch(html, /Audio-to-MIDI pipeline/);

  await Promise.all([
    access(new URL(".nojekyll", root)),
    access(new URL("site-assets/app.js", root)),
    access(new URL("model/model.json", root)),
  ]);
});
