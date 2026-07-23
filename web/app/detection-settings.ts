export const SENSITIVITY_OPTIONS = [
  {
    id: "more",
    label: "More notes",
    description: "Keeps quieter attacks and fast notes.",
    onsetThreshold: 0.28,
    frameThreshold: 0.18,
    minNoteFrames: 3,
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Reduces background notes while keeping normal attacks.",
    onsetThreshold: 0.4,
    frameThreshold: 0.24,
    minNoteFrames: 5,
  },
  {
    id: "clean",
    label: "Cleaner",
    description: "Keeps only stronger, longer notes.",
    onsetThreshold: 0.55,
    frameThreshold: 0.3,
    minNoteFrames: 8,
  },
] as const;

export const PITCH_RANGE_OPTIONS = [
  {
    id: "full",
    label: "Wide · A0–C8",
    description: "Boosts the lowest and highest model octaves.",
    minFrequency: null,
    maxFrequency: null,
  },
  {
    id: "low",
    label: "Low · A0–C5",
    description: "Boosts bass notes and removes upper-register detections.",
    minFrequency: 27.5,
    maxFrequency: 523.25,
  },
  {
    id: "middle",
    label: "Middle · C2–C7",
    description: "Keeps the central register without edge boosting.",
    minFrequency: 65.41,
    maxFrequency: 2093,
  },
  {
    id: "high",
    label: "High · C3–C8",
    description: "Boosts high notes and removes lower-register detections.",
    minFrequency: 130.81,
    maxFrequency: 4186.01,
  },
] as const;

export type SensitivityId = (typeof SENSITIVITY_OPTIONS)[number]["id"];
export type PitchRangeId = (typeof PITCH_RANGE_OPTIONS)[number]["id"];

const MODEL_MIN_MIDI = 21;
const MODEL_MAX_MIDI = 108;
const LOW_RECOVERY_END_MIDI = 48;
const HIGH_RECOVERY_START_MIDI = 84;
const MAX_EDGE_GAIN = 1.25;

function pitchRecoveryGain(pitchMidi: number, pitchRangeId: PitchRangeId) {
  const recoverLow = pitchRangeId === "full" || pitchRangeId === "low";
  const recoverHigh = pitchRangeId === "full" || pitchRangeId === "high";

  if (recoverLow && pitchMidi < LOW_RECOVERY_END_MIDI) {
    const distance =
      (LOW_RECOVERY_END_MIDI - pitchMidi) /
      (LOW_RECOVERY_END_MIDI - MODEL_MIN_MIDI);
    return 1 + Math.min(1, Math.max(0, distance)) * (MAX_EDGE_GAIN - 1);
  }
  if (recoverHigh && pitchMidi > HIGH_RECOVERY_START_MIDI) {
    const distance =
      (pitchMidi - HIGH_RECOVERY_START_MIDI) /
      (MODEL_MAX_MIDI - HIGH_RECOVERY_START_MIDI);
    return 1 + Math.min(1, Math.max(0, distance)) * (MAX_EDGE_GAIN - 1);
  }
  return 1;
}

/**
 * Recovers weaker activations near Basic Pitch's A0 and C8 boundaries.
 * Central pitches are unchanged, avoiding a global increase in false notes.
 */
export function recoverPitchEdges(
  activations: number[][],
  pitchRangeId: PitchRangeId,
  maximumGain = MAX_EDGE_GAIN,
) {
  return activations.map((frame) =>
    frame.map((activation, pitchIndex) =>
      Math.min(
        1,
        activation *
          (1 +
            (pitchRecoveryGain(pitchIndex + MODEL_MIN_MIDI, pitchRangeId) - 1) *
              ((maximumGain - 1) / (MAX_EDGE_GAIN - 1))),
      ),
    ),
  );
}

export function getDetectionSettings(
  sensitivityId: SensitivityId,
  pitchRangeId: PitchRangeId,
) {
  const sensitivity =
    SENSITIVITY_OPTIONS.find((option) => option.id === sensitivityId) ??
    SENSITIVITY_OPTIONS[0];
  const pitchRange =
    PITCH_RANGE_OPTIONS.find((option) => option.id === pitchRangeId) ??
    PITCH_RANGE_OPTIONS[0];

  return {
    onsetThreshold: sensitivity.onsetThreshold,
    frameThreshold: sensitivity.frameThreshold,
    minNoteFrames: sensitivity.minNoteFrames,
    minFrequency: pitchRange.minFrequency,
    maxFrequency: pitchRange.maxFrequency,
    pitchDescription: pitchRange.description,
  };
}
