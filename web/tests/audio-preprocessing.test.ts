import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseMonoSignal,
  normalizeSignal,
  prepareAudioChannels,
  resampleLinear,
} from "../app/audio-preprocessing.ts";

test("chooses one clean channel when a stereo downmix would phase-cancel", () => {
  const left = Float32Array.from([0.5, -0.5, 0.5, -0.5]);
  const right = Float32Array.from([-0.5, 0.5, -0.5, 0.5]);

  assert.deepEqual([...chooseMonoSignal([left, right])], [...left]);
});

test("normalizes quiet audio without clipping", () => {
  const normalized = normalizeSignal(Float32Array.from([0.01, -0.01, 0.01, -0.01]));

  assert.ok(Math.max(...normalized.map(Math.abs)) <= 0.95);
  assert.ok(normalized[0] > 0.01);
});

test("resamples and prepares browser channels at the model rate", () => {
  const input = Float32Array.from({ length: 48_000 }, (_, index) =>
    Math.sin((index / 48_000) * Math.PI * 2 * 440),
  );
  const resampled = resampleLinear(input, 48_000, 24_000);
  const prepared = prepareAudioChannels([input], 48_000, 22_050);

  assert.equal(resampled.length, 24_000);
  assert.equal(prepared.length, 22_050);
});
