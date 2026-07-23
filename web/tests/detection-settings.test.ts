import assert from "node:assert/strict";
import test from "node:test";
import {
  getDetectionSettings,
  PITCH_RANGE_OPTIONS,
  SENSITIVITY_OPTIONS,
} from "../app/detection-settings.ts";

test("the more-notes profile retains weak and short notes", () => {
  const settings = getDetectionSettings("more", "full");

  assert.ok(settings.onsetThreshold < 0.35);
  assert.ok(settings.frameThreshold < 0.25);
  assert.ok(settings.minNoteFrames <= 3);
  assert.equal(settings.minFrequency, null);
  assert.equal(settings.maxFrequency, null);
});

test("the balanced profile is substantially less selective than the old settings", () => {
  const settings = getDetectionSettings("balanced", "full");

  assert.ok(settings.onsetThreshold < 0.62);
  assert.ok(settings.frameThreshold <= 0.25);
  assert.ok(settings.minNoteFrames <= 5);
});

test("sensitivity profiles become progressively more selective", () => {
  for (let index = 1; index < SENSITIVITY_OPTIONS.length; index += 1) {
    const previous = SENSITIVITY_OPTIONS[index - 1];
    const current = SENSITIVITY_OPTIONS[index];
    assert.ok(current.onsetThreshold > previous.onsetThreshold);
    assert.ok(current.frameThreshold > previous.frameThreshold);
    assert.ok(current.minNoteFrames > previous.minNoteFrames);
  }
});

test("pitch focuses form valid ranges inside the model keyboard", () => {
  for (const range of PITCH_RANGE_OPTIONS.slice(1)) {
    assert.ok(range.minFrequency >= 27.5);
    assert.ok(range.maxFrequency <= 4186.01);
    assert.ok(range.minFrequency < range.maxFrequency);
  }
});
