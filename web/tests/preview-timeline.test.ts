import assert from "node:assert/strict";
import test from "node:test";
import type { CleanNote } from "../app/note-cleanup.ts";
import {
  clampPreviewSpeed,
  clampPreviewTime,
  MAX_PREVIEW_SPEED,
  MIN_PREVIEW_SPEED,
  notesForSchedulingWindow,
  playableNotesFrom,
  previewPositionAt,
  previewDuration,
  songTimeToContextTime,
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

test("keeps preview speed between 0.1x and 4.0x", () => {
  assert.equal(MIN_PREVIEW_SPEED, 0.1);
  assert.equal(MAX_PREVIEW_SPEED, 4);
  assert.equal(clampPreviewSpeed(0.01), 0.1);
  assert.equal(clampPreviewSpeed(4.8), 4);
  assert.equal(clampPreviewSpeed(1.26), 1.3);
  assert.equal(clampPreviewSpeed(Number.NaN), 1);
});

test("maps preview time at slow and fast playback speeds", () => {
  assert.equal(songTimeToContextTime(5, 1, 10, 2), 12);
  assert.equal(songTimeToContextTime(5, 1, 10, 0.5), 18);
  assert.equal(previewPositionAt(12, 10, 1, 2), 5);
  assert.equal(previewPositionAt(18, 10, 1, 0.5), 5);
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

test("schedules only a short preview window without duplicating old notes", () => {
  assert.deepEqual(
    notesForSchedulingWindow(notes, 0, 2).map((note) => note.pitchMidi),
    [60],
  );
  assert.deepEqual(
    notesForSchedulingWindow(notes, 1.25, 3.5, true).map(
      (note) => note.pitchMidi,
    ),
    [60, 64],
  );
  assert.deepEqual(
    notesForSchedulingWindow(notes, 1.5, 3.5).map((note) => note.pitchMidi),
    [64],
  );
});
