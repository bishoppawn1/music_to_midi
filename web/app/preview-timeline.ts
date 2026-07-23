import type { CleanNote } from "./note-cleanup";

export function previewDuration(notes: CleanNote[], fallbackDuration = 0) {
  return Math.max(
    fallbackDuration,
    ...notes.map((note) => note.startTimeSeconds + note.durationSeconds),
  );
}

export function clampPreviewTime(time: number, duration: number) {
  if (!Number.isFinite(time)) return 0;
  return Math.min(Math.max(0, duration), Math.max(0, time));
}

export function playableNotesFrom(notes: CleanNote[], offset: number) {
  return notes.filter(
    (note) => note.startTimeSeconds + note.durationSeconds > offset,
  );
}
