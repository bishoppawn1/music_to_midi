import assert from "node:assert/strict";
import test from "node:test";
import {
  getDetectionSettings,
  PITCH_RANGE_OPTIONS,
  recoverPitchEdges,
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

test("wide mode boosts both pitch edges without changing the middle", () => {
  const frame = Array.from({ length: 88 }, () => 0.32);
  const [recovered] = recoverPitchEdges([frame], "full");

  assert.equal(recovered[0], 0.4);
  assert.equal(recovered[43], 0.32);
  assert.equal(recovered[87], 0.4);
});

test("focused ranges boost only their relevant edge", () => {
  const frame = Array.from({ length: 88 }, () => 0.32);
  const [low] = recoverPitchEdges([frame], "low");
  const [high] = recoverPitchEdges([frame], "high");
  const [middle] = recoverPitchEdges([frame], "middle");

  assert.equal(low[0], 0.4);
  assert.equal(low[87], 0.32);
  assert.equal(high[0], 0.32);
  assert.equal(high[87], 0.4);
  assert.deepEqual(middle, frame);
});

test("edge recovery never produces activation above one", () => {
  const frame = Array.from({ length: 88 }, () => 0.9);
  const [recovered] = recoverPitchEdges([frame], "full");

  assert.equal(recovered[0], 1);
  assert.equal(recovered[87], 1);
});
