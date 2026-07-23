import type { CleanNote } from "./note-cleanup";

export function transposeNote(notes: CleanNote[], index: number, semitones: number) {
  return notes.map((note, noteIndex) =>
    noteIndex === index
      ? {
          ...note,
          pitchMidi: Math.min(108, Math.max(21, note.pitchMidi + semitones)),
        }
      : { ...note },
  );
}

export function deleteNote(notes: CleanNote[], index: number) {
  return notes.filter((_, noteIndex) => noteIndex !== index).map((note) => ({ ...note }));
}

export function addNoteAt(notes: CleanNote[], time: number) {
  const orderedPitches = notes.map((note) => note.pitchMidi).sort((left, right) => left - right);
  const pitchMidi = orderedPitches.length
    ? orderedPitches[Math.floor(orderedPitches.length / 2)]
    : 60;
  return [
    ...notes.map((note) => ({ ...note })),
    {
      startTimeSeconds: Math.max(0, time),
      durationSeconds: 0.25,
      pitchMidi,
      amplitude: 0.8,
      onsetConfidence: 1,
    },
  ].sort(
    (left, right) =>
      left.startTimeSeconds - right.startTimeSeconds || left.pitchMidi - right.pitchMidi,
  );
}
