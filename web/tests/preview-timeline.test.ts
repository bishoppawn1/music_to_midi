import assert from "node:assert/strict";
import test from "node:test";
import type { CleanNote } from "../app/note-cleanup.ts";
import {
  clampPreviewTime,
  playableNotesFrom,
  previewDuration,
} from "../app/preview-timeline.ts";

const notes: CleanNote[] = [
  {
    startTimeSeconds: 1,
    durationSeconds: 0.5,
    pitchMidi: 60,
    amplitude: 0.8,
    onsetConfidence: 0.8,
  },
  {
    startTimeSeconds: 3,
    durationSeconds: 1,
    pitchMidi: 64,
    amplitude: 0.8,
    onsetConfidence: 0.8,
  },
];

test("calculates and clamps preview positions", () => {
  assert.equal(previewDuration(notes), 4);
  assert.equal(previewDuration(notes, 6), 6);
  assert.equal(clampPreviewTime(-1, 6), 0);
  assert.equal(clampPreviewTime(9, 6), 6);
  assert.equal(clampPreviewTime(Number.NaN, 6), 0);
});

test("seeking retains a note that is already sounding", () => {
  assert.deepEqual(
    playableNotesFrom(notes, 1.25).map((note) => note.pitchMidi),
    [60, 64],
  );
  assert.deepEqual(
    playableNotesFrom(notes, 2).map((note) => note.pitchMidi),
    [64],
  );
});
