import assert from "node:assert/strict";
import test from "node:test";

import {
  applyInstrumentPolyphony,
  resolveInstrumentProfile,
} from "../app/instrument-polyphony.ts";
import type { AdaptiveNote } from "../app/transcription-accuracy.ts";

function note(overrides: Partial<AdaptiveNote> = {}): AdaptiveNote {
  return {
    startTimeSeconds: 0,
    durationSeconds: 1,
    pitchMidi: 60,
    amplitude: 0.8,
    onsetConfidence: 0.8,
    support: 3,
    ...overrides,
  };
}

test("automatic profile separates bass, solo, and polyphonic parts", () => {
  assert.equal(
    resolveInstrumentProfile("auto", [note({ pitchMidi: 43 })], "melody").id,
    "bass",
  );
  assert.equal(
    resolveInstrumentProfile("auto", [note({ pitchMidi: 72 })], "melody").id,
    "solo",
  );
  assert.equal(
    resolveInstrumentProfile(
      "auto",
      [note(), note({ pitchMidi: 64 })],
      "chords",
    ).id,
    "piano",
  );
});

test("piano profile targets six notes when additional detections are weak", () => {
  const notes = Array.from({ length: 20 }, (_, index) =>
    note({
      pitchMidi: 48 + index,
      amplitude: index < 6 ? 0.85 : 0.24,
      onsetConfidence: index < 6 ? 0.85 : 0.3,
      support: index < 6 ? 3 : 1,
    }),
  );

  const result = applyInstrumentPolyphony(notes, "piano", "chords");

  assert.equal(result.notes.length, 6);
  assert.equal(result.removed, 14);
});

test("piano profile never keeps more notes than ten playable keys", () => {
  const notes = Array.from({ length: 20 }, (_, index) =>
    note({ pitchMidi: 48 + index }),
  );

  const result = applyInstrumentPolyphony(notes, "piano", "chords");

  assert.equal(result.notes.length, 10);
  assert.equal(result.profile.targetPolyphony, 6);
  assert.equal(result.profile.maximumPolyphony, 10);
});

test("guitar profile never keeps more than six simultaneous strings", () => {
  const notes = Array.from({ length: 12 }, (_, index) =>
    note({ pitchMidi: 48 + index }),
  );

  const result = applyInstrumentPolyphony(notes, "guitar", "chords");

  assert.equal(result.notes.length, 6);
});

test("a previously valid note is shortened only when excess polyphony begins", () => {
  const held = note({
    startTimeSeconds: 0,
    durationSeconds: 2,
    pitchMidi: 48,
    amplitude: 0.3,
    onsetConfidence: 0.3,
    support: 1,
  });
  const chord = Array.from({ length: 6 }, (_, index) =>
    note({
      startTimeSeconds: 1,
      pitchMidi: 60 + index,
    }),
  );

  const result = applyInstrumentPolyphony(
    [held, ...chord],
    "guitar",
    "chords",
  );
  const shortened = result.notes.find((entry) => entry.pitchMidi === 48);

  assert.equal(shortened?.durationSeconds, 1);
  assert.equal(result.trimmed, 1);
  assert.equal(
    result.notes.filter((entry) => entry.startTimeSeconds === 1).length,
    6,
  );
});
