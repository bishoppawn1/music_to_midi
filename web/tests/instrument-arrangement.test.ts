import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangeInstrumentTracks,
  selectOuterVoice,
} from "../app/instrument-arrangement.ts";
import type { AdaptiveNote } from "../app/transcription-accuracy.ts";

function note(overrides: Partial<AdaptiveNote> = {}): AdaptiveNote {
  return {
    startTimeSeconds: 0,
    durationSeconds: 0.5,
    pitchMidi: 60,
    amplitude: 0.8,
    onsetConfidence: 0.8,
    support: 3,
    ...overrides,
  };
}

test("piano and trumpet setup assigns every note to one distinct MIDI track", () => {
  const notes = [
    note({ pitchMidi: 48 }),
    note({ pitchMidi: 52 }),
    note({ pitchMidi: 55 }),
    note({ startTimeSeconds: 0.1, pitchMidi: 72 }),
    note({ startTimeSeconds: 0.7, pitchMidi: 74 }),
    note({ startTimeSeconds: 1.3, pitchMidi: 76 }),
  ];

  const result = arrangeInstrumentTracks(notes, "piano-trumpet", "chords");
  const piano = result.tracks.find((track) => track.id === "piano");
  const trumpet = result.tracks.find((track) => track.id === "trumpet");

  assert.equal(result.inferred, false);
  assert.equal(piano?.midiProgram, 0);
  assert.equal(trumpet?.midiProgram, 56);
  assert.deepEqual(
    trumpet?.notes.map((entry) => entry.pitchMidi),
    [72, 74, 76],
  );
  assert.equal(
    result.tracks.reduce((count, track) => count + track.notes.length, 0),
    notes.length,
  );
});

test("automatic setup splits an independently moving lead from chordal piano", () => {
  const notes = [
    note({ startTimeSeconds: 0, durationSeconds: 2, pitchMidi: 48 }),
    note({ startTimeSeconds: 0, durationSeconds: 2, pitchMidi: 52 }),
    note({ startTimeSeconds: 0, durationSeconds: 2, pitchMidi: 55 }),
    note({ startTimeSeconds: 0.25, pitchMidi: 72 }),
    note({ startTimeSeconds: 0.85, pitchMidi: 74 }),
    note({ startTimeSeconds: 1.45, pitchMidi: 76 }),
  ];

  const result = arrangeInstrumentTracks(notes, "auto", "chords");

  assert.deepEqual(
    result.tracks.map((track) => track.id),
    ["piano", "lead"],
  );
  assert.equal(result.inferred, true);
});

test("automatic setup keeps ordinary synchronized chords on one piano track", () => {
  const notes = [60, 64, 67, 72].map((pitchMidi) => note({ pitchMidi }));

  const result = arrangeInstrumentTracks(notes, "auto", "chords");

  assert.deepEqual(result.tracks.map((track) => track.id), ["piano"]);
  assert.equal(result.tracks[0].notes.length, 4);
});

test("lower-voice selection finds a bass line beneath accompaniment", () => {
  const notes = [
    note({ pitchMidi: 40 }),
    note({ pitchMidi: 60 }),
    note({ pitchMidi: 64 }),
    note({ startTimeSeconds: 0.6, pitchMidi: 43 }),
    note({ startTimeSeconds: 0.6, pitchMidi: 62 }),
    note({ startTimeSeconds: 0.6, pitchMidi: 67 }),
  ];

  assert.deepEqual(
    selectOuterVoice(notes, "lower").map((entry) => entry.pitchMidi),
    [40, 43],
  );
});
