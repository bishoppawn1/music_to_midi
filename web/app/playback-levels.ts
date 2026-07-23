export const PREVIEW_MASTER_GAIN = 0.9;

function normalizedAmplitude(amplitude: number) {
  if (!Number.isFinite(amplitude)) return 0;
  return Math.min(1, Math.max(0, amplitude));
}

export function midiVelocity(amplitude: number) {
  return 0.62 + normalizedAmplitude(amplitude) * 0.38;
}

export function previewNoteGain(amplitude: number) {
  return 0.1 + normalizedAmplitude(amplitude) * 0.32;
}
