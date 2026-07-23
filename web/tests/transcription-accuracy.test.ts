import assert from "node:assert/strict";
import test from "node:test";
import type { CleanNote } from "../app/note-cleanup.ts";
import {
  adaptiveDecodeSettings,
  applyTranscriptionMode,
  fuseAdaptivePasses,
  globalTuningBend,
  keepConfidentCandidates,
  pitchBendToMidiValue,
  resolveTranscriptionMode,
  suppressWeakHarmonics,
} from "../app/transcription-accuracy.ts";

function note(overrides: Partial<CleanNote> = {}): CleanNote {
  return {
    startTimeSeconds: 0,
    durationSeconds: 0.4,
    pitchMidi: 60,
    amplitude: 0.7,
    onsetConfidence: 0.7,
    ...overrides,
  };
}

test("adaptive decoding surrounds the selected profile with strict and sensitive passes", () => {
  const passes = adaptiveDecodeSettings({
    onsetThreshold: 0.4,
    frameThreshold: 0.24,
    minNoteFrames: 5,
  });

  assert.equal(passes.length, 3);
  assert.ok(passes[0].onsetThreshold > passes[1].onsetThreshold);
  assert.ok(passes[2].onsetThreshold < passes[1].onsetThreshold);
  assert.equal(passes[0].inferOnsets, false);
});

test("fuses nearby detections and records cross-pass support", () => {
  const fused = fuseAdaptivePasses([
    [note()],
    [note({ startTimeSeconds: 0.02, durationSeconds: 0.8, amplitude: 0.8 })],
    [note({ startTimeSeconds: 0.03 })],
  ]);

  assert.equal(fused.length, 1);
  assert.equal(fused[0].support, 3);
  assert.equal(fused[0].amplitude, 0.8);
});

test("keeps consensus notes and rejects an unsupported weak activation", () => {
  const notes = [
    { ...note(), support: 2 },
    {
      ...note({
        startTimeSeconds: 1,
        pitchMidi: 61,
        amplitude: 0.1,
        onsetConfidence: 0.1,
      }),
      support: 1,
    },
  ];

  assert.deepEqual(
    keepConfidentCandidates(notes, () => false).map((entry) => entry.pitchMidi),
    [60],
  );
});

test("suppresses a weak octave shadow but preserves a strong chord tone", () => {
  const fundamental = note({ pitchMidi: 48, amplitude: 0.9, onsetConfidence: 0.9 });
  const weakOctave = note({ pitchMidi: 60, amplitude: 0.25, onsetConfidence: 0.2 });
  const chordTone = note({ pitchMidi: 64, amplitude: 0.8, onsetConfidence: 0.8 });

  assert.deepEqual(
    suppressWeakHarmonics([fundamental, weakOctave, chordTone]).map(
      (entry) => entry.pitchMidi,
    ),
    [48, 64],
  );
});

test("automatic mode distinguishes a lead line from strong polyphony", () => {
  const melody = [
    { ...note(), support: 3 },
    { ...note({ startTimeSeconds: 0.5, pitchMidi: 62 }), support: 3 },
  ];
  const chord = [
    { ...note(), support: 3 },
    { ...note({ pitchMidi: 64 }), support: 3 },
    { ...note({ pitchMidi: 67 }), support: 3 },
  ];

  assert.equal(resolveTranscriptionMode("auto", melody), "melody");
  assert.equal(resolveTranscriptionMode("auto", chord), "chords");
  assert.equal(applyTranscriptionMode(chord, "melody").notes.length, 1);
});

test("converts model contour bins into standard MIDI pitch-wheel values", () => {
  assert.equal(pitchBendToMidiValue(0), 0);
  assert.equal(pitchBendToMidiValue(3), 4096);
  assert.equal(pitchBendToMidiValue(6), 8191);
  assert.equal(
    globalTuningBend([
      note({ pitchBends: [0.5, 1, 1.5] }),
      note({ pitchBends: [1] }),
    ]),
    pitchBendToMidiValue(1),
  );
});
