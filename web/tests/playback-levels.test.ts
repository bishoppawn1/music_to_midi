import assert from "node:assert/strict";
import test from "node:test";
import {
  midiVelocity,
  PREVIEW_MASTER_GAIN,
  previewNoteGain,
} from "../app/playback-levels.ts";

test("MIDI velocities stay loud while preserving detected dynamics", () => {
  assert.equal(midiVelocity(0), 0.62);
  assert.equal(midiVelocity(0.5), 0.81);
  assert.equal(midiVelocity(1), 1);
  assert.ok(midiVelocity(0.25) < midiVelocity(0.75));
});

test("preview gain is strong and bounded for safe browser playback", () => {
  assert.equal(PREVIEW_MASTER_GAIN, 0.9);
  assert.equal(previewNoteGain(0), 0.1);
  assert.equal(previewNoteGain(0.5), 0.26);
  assert.equal(previewNoteGain(1), 0.42000000000000004);
  assert.equal(previewNoteGain(-10), 0.1);
  assert.equal(previewNoteGain(10), 0.42000000000000004);
  assert.equal(previewNoteGain(Number.NaN), 0.1);
});
