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

export function cycleNoteInstrument(notes: CleanNote[], index: number) {
  const instruments = Array.from(
    new Map(
      notes
        .filter((note) => note.instrumentId)
        .map((note) => [
          note.instrumentId,
          {
            instrumentId: note.instrumentId,
            instrumentName: note.instrumentName,
            instrumentProgram: note.instrumentProgram,
            instrumentProfileId: note.instrumentProfileId,
            instrumentMonophonic: note.instrumentMonophonic,
          },
        ]),
    ).values(),
  );
  const selected = notes[index];
  if (!selected || instruments.length < 2) {
    return notes.map((note) => ({ ...note }));
  }
  const currentIndex = instruments.findIndex(
    (instrument) => instrument.instrumentId === selected.instrumentId,
  );
  const nextInstrument = instruments[(currentIndex + 1) % instruments.length];
  return notes.map((note, noteIndex) =>
    noteIndex === index ? { ...note, ...nextInstrument } : { ...note },
  );
}

export function addNoteAt(notes: CleanNote[], time: number) {
  const orderedPitches = notes.map((note) => note.pitchMidi).sort((left, right) => left - right);
  const pitchMidi = orderedPitches.length
    ? orderedPitches[Math.floor(orderedPitches.length / 2)]
    : 60;
  const nearestNote = [...notes].sort(
    (left, right) =>
      Math.abs(left.startTimeSeconds - time) -
      Math.abs(right.startTimeSeconds - time),
  )[0];
  return [
    ...notes.map((note) => ({ ...note })),
    {
      startTimeSeconds: Math.max(0, time),
      durationSeconds: 0.25,
      pitchMidi,
      amplitude: 0.8,
      onsetConfidence: 1,
      instrumentId: nearestNote?.instrumentId,
      instrumentName: nearestNote?.instrumentName,
      instrumentProgram: nearestNote?.instrumentProgram,
      instrumentProfileId: nearestNote?.instrumentProfileId,
      instrumentMonophonic: nearestNote?.instrumentMonophonic,
    },
  ].sort(
    (left, right) =>
      left.startTimeSeconds - right.startTimeSeconds || left.pitchMidi - right.pitchMidi,
  );
}
