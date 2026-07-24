import type { AdaptiveNote, ResolvedTranscriptionMode } from "./transcription-accuracy";

export const INSTRUMENT_PROFILE_OPTIONS = [
  {
    id: "auto",
    label: "Automatic · infer profile",
    description:
      "Infers a conservative instrument family after listening, then limits impossible note piles.",
  },
  {
    id: "solo",
    label: "Voice / solo · 1 note",
    description: "For voice, flute, saxophone, whistle, and other one-note leads.",
  },
  {
    id: "bass",
    label: "Bass · 1–2 notes",
    description: "Targets one bass note, with room for an occasional double-stop.",
  },
  {
    id: "guitar",
    label: "Guitar · about 4, max 6",
    description: "Targets four simultaneous strings and never keeps more than six.",
  },
  {
    id: "piano",
    label: "Piano / keys · about 6, max 10",
    description: "Targets a six-note texture and never keeps more than ten keys at once.",
  },
  {
    id: "ensemble",
    label: "Ensemble · about 10, max 16",
    description: "Allows denser arrangements while still rejecting extreme note clouds.",
  },
] as const;

export type InstrumentProfileId =
  (typeof INSTRUMENT_PROFILE_OPTIONS)[number]["id"];
export type ResolvedInstrumentProfileId = Exclude<InstrumentProfileId, "auto">;

type InstrumentProfile = {
  id: ResolvedInstrumentProfileId;
  name: string;
  targetPolyphony: number;
  maximumPolyphony: number;
};

const INSTRUMENT_PROFILES: Record<
  ResolvedInstrumentProfileId,
  InstrumentProfile
> = {
  solo: {
    id: "solo",
    name: "Voice / solo",
    targetPolyphony: 1,
    maximumPolyphony: 1,
  },
  bass: {
    id: "bass",
    name: "Bass",
    targetPolyphony: 1,
    maximumPolyphony: 2,
  },
  guitar: {
    id: "guitar",
    name: "Guitar",
    targetPolyphony: 4,
    maximumPolyphony: 6,
  },
  piano: {
    id: "piano",
    name: "Piano / keys",
    targetPolyphony: 6,
    maximumPolyphony: 10,
  },
  ensemble: {
    id: "ensemble",
    name: "Ensemble",
    targetPolyphony: 10,
    maximumPolyphony: 16,
  },
};

const MIN_NOTE_SECONDS = 0.03;
const ONSET_CLUSTER_SECONDS = 0.055;

function quantile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

/**
 * Basic Pitch does not classify timbre, so automatic selection stays honest:
 * it distinguishes a low monophonic part, another solo part, and a polyphonic
 * keyboard-like part. The explicit selector handles instruments whose timbres
 * cannot be safely distinguished from note events alone.
 */
export function resolveInstrumentProfile(
  requested: InstrumentProfileId,
  notes: AdaptiveNote[],
  mode: ResolvedTranscriptionMode,
) {
  let resolvedId: ResolvedInstrumentProfileId;
  if (requested !== "auto") {
    resolvedId = requested;
  } else if (mode === "chords") {
    resolvedId = "piano";
  } else {
    const strongPitches = notes
      .filter(
        (note) =>
          note.support >= 2 ||
          (note.amplitude >= 0.35 && note.onsetConfidence >= 0.4),
      )
      .map((note) => note.pitchMidi);
    const pitches = strongPitches.length
      ? strongPitches
      : notes.map((note) => note.pitchMidi);
    resolvedId = quantile(pitches, 0.8) <= 55 ? "bass" : "solo";
  }

  return {
    ...INSTRUMENT_PROFILES[resolvedId],
    inferred: requested === "auto",
  };
}

function confidenceScore(note: AdaptiveNote) {
  const consensus = Math.min(3, Math.max(0, note.support)) / 3;
  return note.amplitude * 0.45 + note.onsetConfidence * 0.35 + consensus * 0.2;
}

function canExceedTarget(note: AdaptiveNote, targetScore: number) {
  return (
    note.support >= 2 &&
    note.onsetConfidence >= 0.5 &&
    confidenceScore(note) >= targetScore * 0.9
  );
}

type WorkingNote<T extends AdaptiveNote> = {
  note: T;
  originalIndex: number;
  removed: boolean;
};

/**
 * Keeps the most credible notes whenever an instrument would otherwise exceed
 * its playable density. Notes above the usual target need strong onset and
 * cross-pass support, and the physical maximum is absolute.
 */
export function applyInstrumentPolyphony<T extends AdaptiveNote>(
  notes: T[],
  requested: InstrumentProfileId,
  mode: ResolvedTranscriptionMode,
) {
  const profile = resolveInstrumentProfile(requested, notes, mode);
  const working: Array<WorkingNote<T>> = notes.map((note, originalIndex) => ({
    note: { ...note },
    originalIndex,
    removed: false,
  }));
  const orderedStarts = [...working].sort(
    (left, right) =>
      left.note.startTimeSeconds - right.note.startTimeSeconds ||
      left.note.pitchMidi - right.note.pitchMidi,
  );
  let removed = 0;
  let trimmed = 0;

  for (let startIndex = 0; startIndex < orderedStarts.length; ) {
    const clusterStart = orderedStarts[startIndex].note.startTimeSeconds;
    let clusterEndIndex = startIndex + 1;
    while (
      clusterEndIndex < orderedStarts.length &&
      orderedStarts[clusterEndIndex].note.startTimeSeconds - clusterStart <=
        ONSET_CLUSTER_SECONDS
    ) {
      clusterEndIndex += 1;
    }
    const evaluationTime =
      orderedStarts[clusterEndIndex - 1].note.startTimeSeconds;
    const active = working
      .filter(({ note, removed: isRemoved }) => {
        if (isRemoved || note.startTimeSeconds > evaluationTime) return false;
        return (
          note.startTimeSeconds + note.durationSeconds >
          evaluationTime + MIN_NOTE_SECONDS
        );
      })
      .sort(
        (left, right) =>
          confidenceScore(right.note) - confidenceScore(left.note) ||
          right.note.onsetConfidence - left.note.onsetConfidence ||
          left.originalIndex - right.originalIndex,
      );

    if (active.length > profile.targetPolyphony) {
      const targetScore = confidenceScore(
        active[Math.min(profile.targetPolyphony, active.length) - 1].note,
      );
      const allowed = new Set(
        active
          .filter(
            ({ note }, index) =>
              index < profile.targetPolyphony ||
              (index < profile.maximumPolyphony &&
                canExceedTarget(note, targetScore)),
          )
          .map(({ originalIndex }) => originalIndex),
      );

      for (const entry of active) {
        if (allowed.has(entry.originalIndex)) continue;
        if (entry.note.startTimeSeconds < clusterStart - MIN_NOTE_SECONDS) {
          entry.note.durationSeconds =
            clusterStart - entry.note.startTimeSeconds;
          trimmed += 1;
        } else {
          entry.removed = true;
          removed += 1;
        }
      }
    }
    startIndex = clusterEndIndex;
  }

  return {
    notes: working
      .filter(({ note, removed: isRemoved }) => {
        return !isRemoved && note.durationSeconds >= MIN_NOTE_SECONDS;
      })
      .sort(
        (left, right) =>
          left.note.startTimeSeconds - right.note.startTimeSeconds ||
          left.note.pitchMidi - right.note.pitchMidi,
      )
      .map(({ note }) => note),
    profile,
    removed,
    trimmed,
  };
}
