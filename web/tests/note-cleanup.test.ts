import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanRetriggers,
  mergeNoteSpans,
  type CleanNote,
} from "../app/note-cleanup.ts";

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

test("a merged note spans the complete length of both consecutive fragments", () => {
  const result = cleanRetriggers(
    [
      note({ durationSeconds: 0.25 }),
      note({
        startTimeSeconds: 0.25,
        durationSeconds: 0.4,
        onsetConfidence: 0.08,
      }),
    ],
    silentAudio,
  );

  assert.equal(result.notes.length, 1);
  assert.ok(Math.abs(result.notes[0].durationSeconds - 0.65) < 1e-9);
});

test("span merging keeps the earliest start and latest end when notes overlap", () => {
  const merged = mergeNoteSpans(
    note({ startTimeSeconds: 0.1, durationSeconds: 0.4 }),
    note({ startTimeSeconds: 0, durationSeconds: 0.3 }),
  );

  assert.equal(merged.startTimeSeconds, 0);
  assert.equal(merged.durationSeconds, 0.5);
});

test("joins a weak fragment separated by a tiny decoder gap", () => {
  const result = cleanRetriggers(
    [note(), note({ startTimeSeconds: 0.261, onsetConfidence: 0.08 })],
    silentAudio,
  );

  assert.equal(result.notes.length, 1);
  assert.equal(result.merged, 1);
});

test("joins a split note across a small decoder gap with no new attack", () => {
  const result = cleanRetriggers(
    [note(), note({ startTimeSeconds: 0.268, onsetConfidence: 0.08 })],
    silentAudio,
  );

  assert.equal(result.notes.length, 1);
  assert.equal(result.merged, 1);
});

test("keeps a separate note after a clearly audible-sized gap", () => {
  const result = cleanRetriggers(
    [note(), note({ startTimeSeconds: 0.32, onsetConfidence: 0.08 })],
    silentAudio,
  );

  assert.equal(result.notes.length, 2);
  assert.equal(result.merged, 0);
});

test("keeps a quieter repeated note when the waveform has a fresh attack", () => {
  const samples = new Float32Array(22_050);
  for (let index = Math.floor(0.25 * 22_050); index < 0.295 * 22_050; index += 1) {
    samples[index] = index % 2 ? 0.2 : -0.2;
  }
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
