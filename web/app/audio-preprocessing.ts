const TARGET_RMS = 0.12;
const MAX_PEAK = 0.95;

function rms(samples: Float32Array) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function withoutDcOffset(samples: Float32Array) {
  if (!samples.length) return samples;
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  return Float32Array.from(samples, (sample) => sample - mean);
}

export function chooseMonoSignal(channels: Float32Array[]) {
  if (!channels.length) return new Float32Array();
  const cleaned = channels.map(withoutDcOffset);
  if (cleaned.length === 1) return cleaned[0];

  const length = Math.min(...cleaned.map((channel) => channel.length));
  const average = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    for (const channel of cleaned) sum += channel[index];
    average[index] = sum / cleaned.length;
  }

  const strongest = cleaned.reduce((best, channel) =>
    rms(channel) > rms(best) ? channel : best,
  );
  return rms(average) < rms(strongest) * 0.58
    ? strongest.slice(0, length)
    : average;
}

export function normalizeSignal(samples: Float32Array) {
  const level = rms(samples);
  if (!level) return samples.slice();
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = Math.min(MAX_PEAK / Math.max(peak, 1e-6), Math.max(0.5, TARGET_RMS / level), 4);
  return Float32Array.from(samples, (sample) => sample * gain);
}

export function resampleLinear(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
) {
  if (!samples.length || sourceRate === targetRate) return samples.slice();
  const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const scale = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * scale;
    const left = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = sourcePosition - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

export function prepareAudioChannels(
  channels: Float32Array[],
  sourceRate: number,
  targetRate: number,
) {
  return resampleLinear(normalizeSignal(chooseMonoSignal(channels)), sourceRate, targetRate);
}
