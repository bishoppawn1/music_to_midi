export type CleanNote = {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
  onsetConfidence: number;
  pitchBends?: number[];
  instrumentId?: string;
  instrumentName?: string;
  instrumentProgram?: number;
  instrumentProfileId?: string;
  instrumentMonophonic?: boolean;
};

const DEFAULT_SAMPLE_RATE = 22_050;

function rms(samples: Float32Array, start: number, end: number) {
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(samples.length, Math.ceil(end));
  if (to <= from) return 0;
  let sum = 0;
  for (let index = from; index < to; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / (to - from));
}

export function hasFreshAttack(
  samples: Float32Array,
  time: number,
  sampleRate = DEFAULT_SAMPLE_RATE,
) {
  const center = time * sampleRate;
  const before = rms(samples, center - sampleRate * 0.055, center - sampleRate * 0.01);
  const after = rms(samples, center, center + sampleRate * 0.045);
  return after > 0.012 && after > before * 1.22;
}

export function mergeNoteSpans(primary: CleanNote, fragment: CleanNote) {
  const startTimeSeconds = Math.min(
    primary.startTimeSeconds,
    fragment.startTimeSeconds,
  );
  const endTimeSeconds = Math.max(
    primary.startTimeSeconds + primary.durationSeconds,
    fragment.startTimeSeconds + fragment.durationSeconds,
  );
  return {
    ...primary,
    startTimeSeconds,
    durationSeconds: endTimeSeconds - startTimeSeconds,
    amplitude: Math.max(primary.amplitude, fragment.amplitude),
    pitchBends: fragment.pitchBends?.length
      ? [...(primary.pitchBends ?? []), ...fragment.pitchBends]
      : primary.pitchBends,
  };
}

/**
 * Joins only near-contiguous fragments that the model did not mark as a real
 * onset. Deliberate repeated notes are kept even when they touch each other.
 */
export function cleanRetriggers<T extends CleanNote>(
  notes: T[],
  samples: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
) {
  const ordered = [...notes].sort(
    (left, right) =>
      left.startTimeSeconds - right.startTimeSeconds || left.pitchMidi - right.pitchMidi,
  );
  const cleaned: T[] = [];
  const latestByPitch = new Map<number, T>();
  let merged = 0;

  for (const sourceNote of ordered) {
    const note = { ...sourceNote } as T;
    const previous = latestByPitch.get(note.pitchMidi);
    if (previous) {
      const previousEnd = previous.startTimeSeconds + previous.durationSeconds;
      const gap = note.startTimeSeconds - previousEnd;
      const allowedOverlap = Math.min(0.12, previous.durationSeconds * 0.4);
      const isNearContinuousFragment = gap >= -allowedOverlap && gap <= 0.055;
      const hasTrustedModelOnset = note.onsetConfidence >= 0.45;
      const hasAudioAttack = hasFreshAttack(
        samples,
        note.startTimeSeconds,
        sampleRate,
      );

      if (
        isNearContinuousFragment &&
        !hasTrustedModelOnset &&
        !hasAudioAttack
      ) {
        Object.assign(previous, mergeNoteSpans(previous, note));
        merged += 1;
        continue;
      }
    }
    cleaned.push(note);
    latestByPitch.set(note.pitchMidi, note);
  }

  return { notes: cleaned, merged };
}
