import assert from "node:assert/strict";
import test from "node:test";

import { cleanRetriggers, type CleanNote } from "../app/note-cleanup.ts";

const silentAudio = new Float32Array(22_050 * 2);

function note(overrides: Partial<CleanNote> = {}): CleanNote {
  return {
    startTimeSeconds: 0,
    durationSeconds: 0.25,
    pitchMidi: 60,
    amplitude: 0.8,
    onsetConfidence: 0.8,
    ...overrides,
  };
}

test("keeps an intentional repeated note even when it touches the prior note", () => {
  const result = cleanRetriggers(
    [note(), note({ startTimeSeconds: 0.25, onsetConfidence: 0.72 })],
    silentAudio,
  );

  assert.equal(result.notes.length, 2);
  assert.equal(result.merged, 0);
});

test("joins a weak-onset near-contiguous fragment", () => {
  const result = cleanRetriggers(
    [note(), note({ startTimeSeconds: 0.253, onsetConfidence: 0.08 })],
    silentAudio,
  );

  assert.equal(result.notes.length, 1);
  assert.equal(result.merged, 1);
  assert.equal(result.notes[0].durationSeconds, 0.503);
});

test("keeps a weak-onset note when there is a perceptible gap", () => {
  const result = cleanRetriggers(
    [note(), note({ startTimeSeconds: 0.268, onsetConfidence: 0.08 })],
    silentAudio,
  );

  assert.equal(result.notes.length, 2);
  assert.equal(result.merged, 0);
});

test("keeps a quieter repeated onset instead of cleaning it away", () => {
  const samples = new Float32Array(22_050);
  const result = cleanRetriggers([
    note({ durationSeconds: 0.25 }),
    note({
      startTimeSeconds: 0.25,
      durationSeconds: 0.2,
      onsetConfidence: 0.28,
    }),
  ], samples);

  assert.equal(result.notes.length, 2);
  assert.equal(result.merged, 0);
});
