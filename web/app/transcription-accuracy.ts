import type { CleanNote } from "./note-cleanup";

export const TRANSCRIPTION_MODE_OPTIONS = [
  {
    id: "auto",
    name: "Automatic",
    label: "Automatic · app chooses",
    description:
      "The app listens first. It picks Melody for one main tune or Chords for notes played together.",
  },
  {
    id: "melody",
    name: "Melody",
    label: "Melody · one main tune",
    description:
      "Use this for singing, whistling, a flute, or a solo that mostly plays one note at a time.",
  },
  {
    id: "chords",
    name: "Chords",
    label: "Chords · notes together",
    description:
      "Use this for piano chords, strummed guitar, or music with several notes sounding at once.",
  },
] as const;

export type TranscriptionMode = (typeof TRANSCRIPTION_MODE_OPTIONS)[number]["id"];
export type ResolvedTranscriptionMode = Exclude<TranscriptionMode, "auto">;

export type DecodeSettings = {
  onsetThreshold: number;
  frameThreshold: number;
  minNoteFrames: number;
  inferOnsets: boolean;
};

export type AdaptiveNote = CleanNote & { support: number };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function adaptiveDecodeSettings(settings: Omit<DecodeSettings, "inferOnsets">) {
  return [
    {
      onsetThreshold: clamp(settings.onsetThreshold * 1.16, 0.2, 0.9),
      frameThreshold: clamp(settings.frameThreshold * 1.12, 0.12, 0.8),
      minNoteFrames: settings.minNoteFrames + 2,
      inferOnsets: false,
    },
    {
      ...settings,
      inferOnsets: true,
    },
    {
      onsetThreshold: clamp(settings.onsetThreshold * 0.82, 0.2, 0.8),
      frameThreshold: clamp(settings.frameThreshold * 0.84, 0.12, 0.7),
      minNoteFrames: Math.max(2, settings.minNoteFrames - 2),
      inferOnsets: true,
    },
  ];
}

function noteScore(note: CleanNote) {
  return note.amplitude * 0.58 + note.onsetConfidence * 0.42;
}

function matchingNote(left: CleanNote, right: CleanNote) {
  if (left.pitchMidi !== right.pitchMidi) return false;
  const startDifference = Math.abs(left.startTimeSeconds - right.startTimeSeconds);
  return startDifference <= 0.07 && overlapRatio(left, right) >= 0.5;
}

export function fuseAdaptivePasses(passes: CleanNote[][]) {
  const groups: Array<{ notes: CleanNote[]; passIndexes: Set<number> }> = [];
  passes.forEach((notes, passIndex) => {
    for (const note of notes) {
      const group = groups.find((candidate) =>
        candidate.notes.some((existing) => matchingNote(existing, note)),
      );
      if (group) {
        group.notes.push(note);
        group.passIndexes.add(passIndex);
      } else {
        groups.push({ notes: [note], passIndexes: new Set([passIndex]) });
      }
    }
  });

  return groups.map(({ notes, passIndexes }) => {
    const representative = [...notes].sort((left, right) => noteScore(right) - noteScore(left))[0];
    const startTimeSeconds = Math.min(
      ...notes.map((note) => note.startTimeSeconds),
    );
    const endTimeSeconds = Math.max(
      ...notes.map(
        (note) => note.startTimeSeconds + note.durationSeconds,
      ),
    );
    return {
      ...representative,
      startTimeSeconds,
      durationSeconds: endTimeSeconds - startTimeSeconds,
      amplitude: Math.max(...notes.map((note) => note.amplitude)),
      onsetConfidence: Math.max(...notes.map((note) => note.onsetConfidence)),
      support: passIndexes.size,
    };
  });
}

export function keepConfidentCandidates(
  notes: AdaptiveNote[],
  hasFreshAttack: (time: number) => boolean,
) {
  return notes.filter(
    (note) =>
      note.support >= 2 ||
      (note.onsetConfidence >= 0.42 && note.amplitude >= 0.22) ||
      (note.amplitude >= 0.3 && hasFreshAttack(note.startTimeSeconds)),
  );
}

const HARMONIC_INTERVALS = new Set([12, 19, 24, 28, 31, 36]);

function overlapRatio(left: CleanNote, right: CleanNote) {
  const overlap = Math.max(
    0,
    Math.min(
      left.startTimeSeconds + left.durationSeconds,
      right.startTimeSeconds + right.durationSeconds,
    ) - Math.max(left.startTimeSeconds, right.startTimeSeconds),
  );
  return overlap / Math.max(0.001, Math.min(left.durationSeconds, right.durationSeconds));
}

export function suppressWeakHarmonics<T extends CleanNote>(notes: T[]) {
  return notes.filter((upper) => {
    const shadowed = notes.some((lower) => {
      const interval = upper.pitchMidi - lower.pitchMidi;
      if (!HARMONIC_INTERVALS.has(interval)) return false;
      if (Math.abs(upper.startTimeSeconds - lower.startTimeSeconds) > 0.055) return false;
      if (overlapRatio(upper, lower) < 0.72) return false;
      return (
        noteScore(upper) < noteScore(lower) * 0.62 &&
        upper.onsetConfidence < lower.onsetConfidence * 0.8
      );
    });
    return !shadowed;
  });
}

function hasStrongPolyphony(notes: AdaptiveNote[]) {
  let polyphonic = 0;
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const strongOverlap = notes.some((other, otherIndex) => {
      if (index === otherIndex || note.pitchMidi === other.pitchMidi) return false;
      return (
        overlapRatio(note, other) >= 0.45 &&
        noteScore(other) >= noteScore(note) * 0.7 &&
        other.support >= 2
      );
    });
    if (strongOverlap) polyphonic += 1;
  }
  return notes.length > 0 && polyphonic / notes.length >= 0.18;
}

export function resolveTranscriptionMode(
  requested: TranscriptionMode,
  notes: AdaptiveNote[],
): ResolvedTranscriptionMode {
  if (requested !== "auto") return requested;
  return hasStrongPolyphony(notes) ? "chords" : "melody";
}

export function enforceMelody<T extends CleanNote>(notes: T[]) {
  const ranked = [...notes].sort((left, right) => noteScore(right) - noteScore(left));
  const selected: T[] = [];
  for (const note of ranked) {
    const conflicting = selected.some(
      (existing) => overlapRatio(note, existing) > 0.48,
    );
    if (!conflicting) selected.push(note);
  }
  return selected.sort(
    (left, right) =>
      left.startTimeSeconds - right.startTimeSeconds || left.pitchMidi - right.pitchMidi,
  );
}

export function applyTranscriptionMode(
  notes: AdaptiveNote[],
  requested: TranscriptionMode,
) {
  const withoutHarmonics = suppressWeakHarmonics(notes);
  const resolvedMode = resolveTranscriptionMode(requested, withoutHarmonics);
  return {
    notes:
      resolvedMode === "melody"
        ? enforceMelody(withoutHarmonics)
        : withoutHarmonics,
    resolvedMode,
  };
}

export function pitchBendToMidiValue(bend: number) {
  const value = Math.round(bend * (8192 / 6));
  return Math.min(8191, Math.max(-8192, value));
}

export function smoothPitchBends(bends: number[], radius = 2) {
  if (bends.length < 3) return [...bends];
  return bends.map((_, index) => {
    const window = bends
      .slice(Math.max(0, index - radius), index + radius + 1)
      .sort((left, right) => left - right);
    return window[Math.floor(window.length / 2)];
  });
}

export function globalTuningBend(notes: CleanNote[]) {
  const bends = notes
    .flatMap((note) => note.pitchBends ?? [])
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!bends.length) return 0;
  const middle = Math.floor(bends.length / 2);
  const median =
    bends.length % 2 ? bends[middle] : (bends[middle - 1] + bends[middle]) / 2;
  return pitchBendToMidiValue(median);
}
