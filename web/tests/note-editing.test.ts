import assert from "node:assert/strict";
import test from "node:test";
import type { CleanNote } from "../app/note-cleanup.ts";
import {
  addNoteAt,
  deleteNote,
  transposeNote,
} from "../app/note-editing.ts";

const notes: CleanNote[] = [
  {
    startTimeSeconds: 1,
    durationSeconds: 0.5,
    pitchMidi: 60,
    amplitude: 0.8,
    onsetConfidence: 0.8,
  },
  {
    startTimeSeconds: 2,
    durationSeconds: 0.5,
    pitchMidi: 64,
    amplitude: 0.8,
    onsetConfidence: 0.8,
  },
];

test("transposes only the selected note inside the model range", () => {
  assert.deepEqual(
    transposeNote(notes, 1, 1).map((note) => note.pitchMidi),
    [60, 65],
  );
  assert.equal(transposeNote([{ ...notes[0], pitchMidi: 108 }], 0, 1)[0].pitchMidi, 108);
});

test("deletes a selected note and adds a missing note at the playhead", () => {
  assert.deepEqual(deleteNote(notes, 0).map((note) => note.pitchMidi), [64]);
  const added = addNoteAt(notes, 1.5);
  assert.equal(added.length, 3);
  assert.equal(added[1].startTimeSeconds, 1.5);
  assert.equal(added[1].pitchMidi, 64);
});
