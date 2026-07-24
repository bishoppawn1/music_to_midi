import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangeInstrumentTracks,
  classifyLikelyInstrument,
  selectOuterVoice,
  summarizeTimbre,
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

test("timbre analysis distinguishes a harmonically bright tone from a pure tone", () => {
  const sampleRate = 22_050;
  const pure = new Float32Array(sampleRate);
  const bright = new Float32Array(sampleRate);
  const frequency = 440;
  for (let index = 0; index < sampleRate; index += 1) {
    const phase = (2 * Math.PI * frequency * index) / sampleRate;
    pure[index] = Math.sin(phase) * 0.3;
    bright[index] =
      Math.sin(phase) * 0.2 +
      Math.sin(phase * 3) * 0.15 +
      Math.sin(phase * 5) * 0.1;
  }
  const detected = [note({ pitchMidi: 69, durationSeconds: 0.8 })];

  const pureTimbre = summarizeTimbre(detected, pure, sampleRate);
  const brightTimbre = summarizeTimbre(detected, bright, sampleRate);

  assert.ok(
    brightTimbre.harmonicBrightness > pureTimbre.harmonicBrightness,
  );
  assert.ok(pureTimbre.sustainRatio > 0.8);
});

test("likely-instrument classifier maps sustained lead timbres without a preset", () => {
  const notes = [note({ pitchMidi: 72, durationSeconds: 0.8 })];

  assert.equal(
    classifyLikelyInstrument(
      "lead",
      {
        attackContrast: 1.3,
        sustainRatio: 0.95,
        harmonicBrightness: 2.1,
        medianDuration: 0.8,
      },
      notes,
    ).id,
    "trumpet",
  );
  assert.equal(
    classifyLikelyInstrument(
      "lead",
      {
        attackContrast: 1.2,
        sustainRatio: 0.94,
        harmonicBrightness: 1.1,
        medianDuration: 0.8,
      },
      notes,
    ).id,
    "flute",
  );
});

test("likely-instrument classifier distinguishes piano, guitar, and strings accompaniment", () => {
  const pianoNotes = [48, 60, 64].map((pitchMidi) => note({ pitchMidi }));
  const guitarNotes = [40, 45, 50, 55, 59, 64].map((pitchMidi) =>
    note({ pitchMidi }),
  );

  assert.equal(
    classifyLikelyInstrument(
      "accompaniment",
      {
        attackContrast: 1.8,
        sustainRatio: 0.6,
        harmonicBrightness: 1.5,
        medianDuration: 0.6,
      },
      pianoNotes,
    ).id,
    "piano",
  );
  assert.equal(
    classifyLikelyInstrument(
      "accompaniment",
      {
        attackContrast: 3,
        sustainRatio: 0.5,
        harmonicBrightness: 1.8,
        medianDuration: 0.6,
      },
      guitarNotes,
    ).id,
    "guitar",
  );
  assert.equal(
    classifyLikelyInstrument(
      "accompaniment",
      {
        attackContrast: 1.4,
        sustainRatio: 0.95,
        harmonicBrightness: 1.7,
        medianDuration: 1.2,
      },
      pianoNotes,
    ).id,
    "ensemble",
  );
});

test("automatic analysis splits an independently moving lead from chordal piano", () => {
  const notes = [
    note({ startTimeSeconds: 0, durationSeconds: 2, pitchMidi: 48 }),
    note({ startTimeSeconds: 0, durationSeconds: 2, pitchMidi: 52 }),
    note({ startTimeSeconds: 0, durationSeconds: 2, pitchMidi: 55 }),
    note({ startTimeSeconds: 0.25, pitchMidi: 72 }),
    note({ startTimeSeconds: 0.85, pitchMidi: 74 }),
    note({ startTimeSeconds: 1.45, pitchMidi: 76 }),
  ];

  const result = arrangeInstrumentTracks(
    notes,
    "chords",
    new Float32Array(22_050 * 2),
  );

  assert.deepEqual(
    result.tracks.map((track) => track.id),
    ["piano", "flute"],
  );
  assert.equal(
    result.tracks.reduce((count, track) => count + track.notes.length, 0),
    notes.length,
  );
});

test("automatic analysis keeps ordinary synchronized chords on one piano track", () => {
  const notes = [60, 64, 67, 72].map((pitchMidi) => note({ pitchMidi }));

  const result = arrangeInstrumentTracks(
    notes,
    "chords",
    new Float32Array(22_050),
  );

  assert.deepEqual(result.tracks.map((track) => track.id), ["piano"]);
  assert.equal(result.tracks[0].notes.length, 4);
});

test("automatic analysis separates an independently moving low bass role", () => {
  const notes = [
    note({ startTimeSeconds: 0, durationSeconds: 2, pitchMidi: 60 }),
    note({ startTimeSeconds: 0, durationSeconds: 2, pitchMidi: 64 }),
    note({ startTimeSeconds: 0, durationSeconds: 2, pitchMidi: 67 }),
    note({ startTimeSeconds: 0.2, pitchMidi: 40 }),
    note({ startTimeSeconds: 0.8, pitchMidi: 43 }),
    note({ startTimeSeconds: 1.4, pitchMidi: 45 }),
  ];

  const result = arrangeInstrumentTracks(
    notes,
    "chords",
    new Float32Array(22_050 * 2),
  );

  assert.deepEqual(
    result.tracks.map((track) => track.id),
    ["piano", "bass"],
  );
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
