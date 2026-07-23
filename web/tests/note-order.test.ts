import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNoteDirection,
  reverseNoteOrder,
} from "../app/note-order.ts";
import type { CleanNote } from "../app/note-cleanup.ts";

function note(
  pitchMidi: number,
  startTimeSeconds: number,
  durationSeconds: number,
): CleanNote {
  return {
    pitchMidi,
    startTimeSeconds,
    durationSeconds,
    amplitude: 0.8,
    onsetConfidence: 0.8,
  };
}

test("reverse order mirrors notes across the detected phrase", () => {
  const reversed = reverseNoteOrder([
    note(60, 2, 1),
    note(64, 5, 0.5),
    note(67, 8, 2),
  ]);

  assert.deepEqual(
    reversed.map(({ pitchMidi, startTimeSeconds, durationSeconds }) => ({
      pitchMidi,
      startTimeSeconds,
      durationSeconds,
    })),
    [
      { pitchMidi: 67, startTimeSeconds: 2, durationSeconds: 2 },
      { pitchMidi: 64, startTimeSeconds: 6.5, durationSeconds: 0.5 },
      { pitchMidi: 60, startTimeSeconds: 9, durationSeconds: 1 },
    ],
  );
});

test("reverse order preserves chords and note properties", () => {
  const reversed = reverseNoteOrder([
    note(60, 1, 0.5),
    note(64, 1, 0.5),
    note(72, 3, 1),
  ]);

  assert.equal(reversed[0].pitchMidi, 72);
  assert.equal(reversed[1].startTimeSeconds, 3.5);
  assert.equal(reversed[2].startTimeSeconds, 3.5);
  assert.equal(reversed[1].amplitude, 0.8);
  assert.equal(reversed[1].onsetConfidence, 0.8);
});

test("reversing twice restores the original timing", () => {
  const original = [
    note(60, 0.25, 0.4),
    note(62, 1.1, 0.2),
    note(64, 2, 0.7),
  ];
  const restored = reverseNoteOrder(reverseNoteOrder(original));

  assert.deepEqual(restored, original);
});

test("forward direction returns a sorted copy", () => {
  const original = [note(67, 2, 0.5), note(60, 1, 0.25)];
  const ordered = applyNoteDirection(original, "forward");

  assert.deepEqual(ordered.map((entry) => entry.pitchMidi), [60, 67]);
  assert.notEqual(ordered[0], original[1]);
});
