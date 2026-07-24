import assert from "node:assert/strict";
import test from "node:test";
import toneMidi from "@tonejs/midi";

import { makeMultiTrackMidi } from "../app/midi-output.ts";
import type { CleanNote } from "../app/note-cleanup.ts";

const { Midi } = toneMidi;

function note(overrides: Partial<CleanNote> = {}): CleanNote {
  return {
    startTimeSeconds: 0,
    durationSeconds: 0.5,
    pitchMidi: 60,
    amplitude: 0.8,
    onsetConfidence: 0.8,
    ...overrides,
  };
}

test("writes separately assigned piano and trumpet notes to distinct MIDI tracks", async () => {
  const bytes = await makeMultiTrackMidi([
    note({
      pitchMidi: 48,
      instrumentId: "piano",
      instrumentName: "Acoustic piano",
      instrumentProgram: 0,
    }),
    note({
      pitchMidi: 72,
      instrumentId: "trumpet",
      instrumentName: "Trumpet",
      instrumentProgram: 56,
      instrumentMonophonic: true,
    }),
  ]);
  const midi = new Midi(bytes);

  assert.equal(midi.tracks.length, 2);
  assert.deepEqual(
    midi.tracks.map((track) => track.name),
    ["Acoustic piano", "Trumpet"],
  );
  assert.deepEqual(
    midi.tracks.map((track) => track.instrument.number),
    [0, 56],
  );
  assert.deepEqual(
    midi.tracks.map((track) => track.channel),
    [0, 1],
  );
  assert.deepEqual(
    midi.tracks.map((track) => track.notes.map((entry) => entry.midi)),
    [[48], [72]],
  );
});
