export type CleanNote = {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
  onsetConfidence: number;
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

function hasFreshAttack(
  samples: Float32Array,
  time: number,
  sampleRate = DEFAULT_SAMPLE_RATE,
) {
  const center = time * sampleRate;
  const before = rms(samples, center - sampleRate * 0.055, center - sampleRate * 0.01);
  const after = rms(samples, center, center + sampleRate * 0.045);
  return after > 0.012 && after > before * 1.22;
}

/**
 * Joins only near-contiguous fragments that the model did not mark as a real
 * onset. Deliberate repeated notes are kept even when they touch each other.
 */
export function cleanRetriggers(
  notes: CleanNote[],
  samples: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
) {
  const ordered = [...notes].sort(
    (left, right) =>
      left.startTimeSeconds - right.startTimeSeconds || left.pitchMidi - right.pitchMidi,
  );
  const cleaned: CleanNote[] = [];
  const latestByPitch = new Map<number, CleanNote>();
  let merged = 0;

  for (const sourceNote of ordered) {
    const note = { ...sourceNote };
    const previous = latestByPitch.get(note.pitchMidi);
    if (previous) {
      const previousEnd = previous.startTimeSeconds + previous.durationSeconds;
      const gap = note.startTimeSeconds - previousEnd;
      const isNearContinuousFragment = gap >= -0.006 && gap <= 0.006;
      const hasModelOnset = note.onsetConfidence >= 0.25;

      if (
        isNearContinuousFragment &&
        !hasModelOnset &&
        !hasFreshAttack(samples, note.startTimeSeconds, sampleRate)
      ) {
        previous.durationSeconds =
          Math.max(previousEnd, note.startTimeSeconds + note.durationSeconds) -
          previous.startTimeSeconds;
        previous.amplitude = Math.max(previous.amplitude, note.amplitude);
        merged += 1;
        continue;
      }
    }
    cleaned.push(note);
    latestByPitch.set(note.pitchMidi, note);
  }

  return { notes: cleaned, merged };
}
