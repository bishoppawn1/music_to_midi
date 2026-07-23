import type { CleanNote } from "./note-cleanup";

export const MIN_PREVIEW_SPEED = 0.1;
export const MAX_PREVIEW_SPEED = 4;

export function previewDuration(notes: CleanNote[], fallbackDuration = 0) {
  return Math.max(
    fallbackDuration,
    ...notes.map((note) => note.startTimeSeconds + note.durationSeconds),
  );
}

export function clampPreviewSpeed(speed: number) {
  if (!Number.isFinite(speed)) return 1;
  const roundedSpeed = Math.round(speed * 10) / 10;
  return Math.min(
    MAX_PREVIEW_SPEED,
    Math.max(MIN_PREVIEW_SPEED, roundedSpeed),
  );
}

export function songTimeToContextTime(
  songTime: number,
  offset: number,
  contextBaseTime: number,
  speed: number,
) {
  return contextBaseTime + (songTime - offset) / clampPreviewSpeed(speed);
}

export function previewPositionAt(
  contextTime: number,
  contextBaseTime: number,
  offset: number,
  speed: number,
) {
  return (
    offset +
    Math.max(0, contextTime - contextBaseTime) * clampPreviewSpeed(speed)
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

export function notesForSchedulingWindow(
  notes: CleanNote[],
  windowStart: number,
  windowEnd: number,
  includeAlreadyPlaying = false,
) {
  return notes.filter((note) => {
    const noteEnd = note.startTimeSeconds + note.durationSeconds;
    const beginsInWindow =
      note.startTimeSeconds >= windowStart && note.startTimeSeconds < windowEnd;
    const alreadyPlaying =
      includeAlreadyPlaying &&
      note.startTimeSeconds < windowStart &&
      noteEnd > windowStart;
    return beginsInWindow || alreadyPlaying;
  });
}
