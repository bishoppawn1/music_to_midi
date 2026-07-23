import type { CleanNote } from "./note-cleanup";

export const NOTE_DIRECTION_OPTIONS = [
  {
    id: "forward",
    label: "Forward · first to last",
    description: "Writes detected notes in their original order.",
  },
  {
    id: "reverse",
    label: "Reverse · last to first",
    description: "Mirrors note timing so the finished MIDI plays backward.",
  },
] as const;

export type NoteDirection = (typeof NOTE_DIRECTION_OPTIONS)[number]["id"];

function sortNotes(notes: CleanNote[]) {
  return notes.sort(
    (left, right) =>
      left.startTimeSeconds - right.startTimeSeconds ||
      left.pitchMidi - right.pitchMidi,
  );
}

export function reverseNoteOrder(notes: CleanNote[]) {
  if (!notes.length) return [];

  const phraseStart = Math.min(...notes.map((note) => note.startTimeSeconds));
  const phraseEnd = Math.max(
    ...notes.map((note) => note.startTimeSeconds + note.durationSeconds),
  );

  return sortNotes(
    notes.map((note) => ({
      ...note,
      startTimeSeconds: Math.max(
        phraseStart,
        phraseStart + phraseEnd - (note.startTimeSeconds + note.durationSeconds),
      ),
    })),
  );
}

export function applyNoteDirection(
  notes: CleanNote[],
  direction: NoteDirection,
) {
  if (direction === "reverse") return reverseNoteOrder(notes);
  return sortNotes(notes.map((note) => ({ ...note })));
}
