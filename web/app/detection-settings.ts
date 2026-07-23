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
    label: "Full · A0–C8",
    minFrequency: null,
    maxFrequency: null,
  },
  {
    id: "low",
    label: "Low · A0–C5",
    minFrequency: 27.5,
    maxFrequency: 523.25,
  },
  {
    id: "middle",
    label: "Middle · C2–C7",
    minFrequency: 65.41,
    maxFrequency: 2093,
  },
  {
    id: "high",
    label: "High · C3–C8",
    minFrequency: 130.81,
    maxFrequency: 4186.01,
  },
] as const;

export type SensitivityId = (typeof SENSITIVITY_OPTIONS)[number]["id"];
export type PitchRangeId = (typeof PITCH_RANGE_OPTIONS)[number]["id"];

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
  };
}
