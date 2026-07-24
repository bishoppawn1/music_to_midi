import type { AdaptiveNote, ResolvedTranscriptionMode } from "./transcription-accuracy";
import type { ResolvedInstrumentProfileId } from "./instrument-polyphony";

export type TimbreSummary = {
  attackContrast: number;
  sustainRatio: number;
  harmonicBrightness: number;
  medianDuration: number;
};

type InstrumentRole = "lead" | "bass" | "accompaniment";

type InstrumentDefinition = {
  id: string;
  name: string;
  midiProgram: number;
  profileId: ResolvedInstrumentProfileId;
  monophonic: boolean;
};

export type InstrumentTrack = InstrumentDefinition & {
  mode: ResolvedTranscriptionMode;
  notes: AdaptiveNote[];
  timbre: TimbreSummary;
};

const INSTRUMENTS: Record<string, InstrumentDefinition> = {
  piano: {
    id: "piano",
    name: "Acoustic piano",
    midiProgram: 0,
    profileId: "piano",
    monophonic: false,
  },
  guitar: {
    id: "guitar",
    name: "Steel guitar",
    midiProgram: 25,
    profileId: "guitar",
    monophonic: false,
  },
  bass: {
    id: "bass",
    name: "Fingered bass",
    midiProgram: 33,
    profileId: "bass",
    monophonic: true,
  },
  strings: {
    id: "ensemble",
    name: "String ensemble",
    midiProgram: 48,
    profileId: "ensemble",
    monophonic: false,
  },
  trumpet: {
    id: "trumpet",
    name: "Trumpet",
    midiProgram: 56,
    profileId: "solo",
    monophonic: true,
  },
  flute: {
    id: "flute",
    name: "Flute",
    midiProgram: 73,
    profileId: "solo",
    monophonic: true,
  },
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values: number[], fallback = 0) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: number[], fraction: number, fallback = 0) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function rms(samples: Float32Array, from: number, to: number) {
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(samples.length, Math.ceil(to));
  if (end <= start) return 0;
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / (end - start));
}

function differenceRms(samples: Float32Array, from: number, to: number) {
  const start = Math.max(1, Math.floor(from));
  const end = Math.min(samples.length, Math.ceil(to));
  if (end <= start) return 0;
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    const difference = samples[index] - samples[index - 1];
    sum += difference * difference;
  }
  return Math.sqrt(sum / (end - start));
}

/**
 * Estimates attack, decay, and harmonic complexity around the notes assigned
 * to one musical role. Comparing the first-difference energy with the expected
 * fundamental keeps a high trumpet pitch from looking bright merely because
 * it is high.
 */
export function summarizeTimbre(
  notes: AdaptiveNote[],
  samples: Float32Array,
  sampleRate = 22_050,
): TimbreSummary {
  const attacks: number[] = [];
  const sustains: number[] = [];
  const brightness: number[] = [];

  for (const note of notes) {
    const start = note.startTimeSeconds * sampleRate;
    const end =
      (note.startTimeSeconds + Math.max(0.04, note.durationSeconds)) *
      sampleRate;
    const before = rms(
      samples,
      start - sampleRate * 0.055,
      start - sampleRate * 0.008,
    );
    const attackEnd = Math.min(end, start + sampleRate * 0.065);
    const attack = rms(samples, start, attackEnd);
    const bodyStart = Math.min(end, start + sampleRate * 0.12);
    const bodyEnd = Math.min(end, start + sampleRate * 0.34);
    const body = rms(samples, bodyStart, bodyEnd);
    attacks.push(attack / Math.max(0.006, before));
    sustains.push(clamp(body / Math.max(0.006, attack), 0, 2));

    if (body > 0.006 && bodyEnd > bodyStart) {
      const difference = differenceRms(samples, bodyStart, bodyEnd);
      const fundamentalFrequency = 440 * 2 ** ((note.pitchMidi - 69) / 12);
      const expectedDifference = Math.max(
        0.001,
        2 * Math.sin((Math.PI * fundamentalFrequency) / sampleRate),
      );
      brightness.push(
        clamp(difference / body / expectedDifference, 0, 8),
      );
    }
  }

  return {
    attackContrast: median(attacks, 1),
    sustainRatio: median(sustains, 0.7),
    harmonicBrightness: median(brightness, 1),
    medianDuration: median(
      notes.map((note) => note.durationSeconds),
      0.5,
    ),
  };
}

function maximumOnsetPolyphony(notes: AdaptiveNote[]) {
  return notes.reduce((maximum, note) => {
    const simultaneous = notes.filter(
      (other) =>
        Math.abs(other.startTimeSeconds - note.startTimeSeconds) <= 0.06,
    ).length;
    return Math.max(maximum, simultaneous);
  }, 0);
}

/**
 * Maps measurable role and timbre evidence to a likely General MIDI family.
 * These labels are estimates, so the piano-roll correction control remains
 * available when a mixed recording masks an instrument's harmonics.
 */
export function classifyLikelyInstrument(
  role: InstrumentRole,
  timbre: TimbreSummary,
  notes: AdaptiveNote[],
) {
  if (role === "bass") return INSTRUMENTS.bass;

  if (role === "lead") {
    const percussive =
      timbre.attackContrast >= 2.4 && timbre.sustainRatio < 0.72;
    if (percussive) {
      return quantile(
        notes.map((note) => note.pitchMidi),
        0.8,
        60,
      ) <= 76
        ? INSTRUMENTS.guitar
        : INSTRUMENTS.piano;
    }
    return timbre.harmonicBrightness >= 1.65
      ? INSTRUMENTS.trumpet
      : INSTRUMENTS.flute;
  }

  const pitches = notes.map((note) => note.pitchMidi);
  const pitchSpan = pitches.length
    ? Math.max(...pitches) - Math.min(...pitches)
    : 0;
  const sustained =
    timbre.sustainRatio >= 0.82 &&
    timbre.medianDuration >= 0.75 &&
    timbre.attackContrast < 2.2;
  if (sustained) return INSTRUMENTS.strings;

  const guitarLike =
    maximumOnsetPolyphony(notes) <= 6 &&
    pitchSpan <= 45 &&
    timbre.attackContrast >= 2.1 &&
    timbre.medianDuration < 1.1;
  return guitarLike ? INSTRUMENTS.guitar : INSTRUMENTS.piano;
}

function confidenceScore(note: AdaptiveNote) {
  const consensus = Math.min(3, Math.max(0, note.support)) / 3;
  return note.amplitude * 0.45 + note.onsetConfidence * 0.35 + consensus * 0.2;
}

function overlapRatio(left: AdaptiveNote, right: AdaptiveNote) {
  const overlap = Math.max(
    0,
    Math.min(
      left.startTimeSeconds + left.durationSeconds,
      right.startTimeSeconds + right.durationSeconds,
    ) - Math.max(left.startTimeSeconds, right.startTimeSeconds),
  );
  return overlap / Math.max(0.001, Math.min(left.durationSeconds, right.durationSeconds));
}

function voiceScore(
  note: AdaptiveNote,
  minimumPitch: number,
  maximumPitch: number,
  direction: "upper" | "lower",
) {
  const pitchPosition =
    (note.pitchMidi - minimumPitch) / Math.max(1, maximumPitch - minimumPitch);
  const directionalPitch =
    direction === "upper" ? pitchPosition : 1 - pitchPosition;
  const durationSupport = Math.min(1, note.durationSeconds / 0.75);
  return (
    confidenceScore(note) * 0.55 +
    directionalPitch * 0.35 +
    durationSupport * 0.1
  );
}

export function selectOuterVoice(
  notes: AdaptiveNote[],
  direction: "upper" | "lower",
) {
  if (!notes.length) return [];
  const pitches = notes.map((note) => note.pitchMidi);
  const minimumPitch = Math.min(...pitches);
  const maximumPitch = Math.max(...pitches);
  const ranked = [...notes].sort(
    (left, right) =>
      voiceScore(right, minimumPitch, maximumPitch, direction) -
        voiceScore(left, minimumPitch, maximumPitch, direction) ||
      left.startTimeSeconds - right.startTimeSeconds,
  );
  const selected: AdaptiveNote[] = [];
  for (const note of ranked) {
    if (selected.every((existing) => overlapRatio(note, existing) <= 0.48)) {
      selected.push(note);
    }
  }
  return selected.sort(
    (left, right) =>
      left.startTimeSeconds - right.startTimeSeconds ||
      left.pitchMidi - right.pitchMidi,
  );
}

function splitVoice(notes: AdaptiveNote[], direction: "upper" | "lower") {
  const voice = selectOuterVoice(notes, direction);
  const voiceSet = new Set(voice);
  return {
    voice,
    accompaniment: notes.filter((note) => !voiceSet.has(note)),
  };
}

function hasIndependentVoice(
  voice: AdaptiveNote[],
  accompaniment: AdaptiveNote[],
) {
  if (voice.length < 3 || accompaniment.length < 3) return false;
  const independentOnsets = voice.filter(
    (voiceNote) =>
      accompaniment.every(
        (note) =>
          Math.abs(note.startTimeSeconds - voiceNote.startTimeSeconds) > 0.06,
      ),
  ).length;
  const accompanimentHasChords = accompaniment.some((note, index) =>
    accompaniment.some(
      (other, otherIndex) =>
        index !== otherIndex &&
        note.pitchMidi !== other.pitchMidi &&
        overlapRatio(note, other) >= 0.45,
    ),
  );
  return accompanimentHasChords && independentOnsets / voice.length >= 0.34;
}

function makeLikelyTrack(
  role: InstrumentRole,
  notes: AdaptiveNote[],
  samples: Float32Array,
  sampleRate: number,
): InstrumentTrack {
  const timbre = summarizeTimbre(notes, samples, sampleRate);
  const definition = classifyLikelyInstrument(role, timbre, notes);
  return {
    ...definition,
    notes,
    mode: role === "accompaniment" ? "chords" : "melody",
    timbre,
  };
}

export function arrangeInstrumentTracks(
  notes: AdaptiveNote[],
  mode: ResolvedTranscriptionMode,
  samples: Float32Array,
  sampleRate = 22_050,
) {
  if (mode === "melody") {
    const upperPitch = quantile(
      notes.map((note) => note.pitchMidi),
      0.8,
      60,
    );
    return {
      tracks: [
        makeLikelyTrack(
          upperPitch <= 55 ? "bass" : "lead",
          notes,
          samples,
          sampleRate,
        ),
      ],
      inferred: true,
    };
  }

  let accompaniment = notes;
  const separated: Array<{ role: InstrumentRole; notes: AdaptiveNote[] }> = [];
  const lower = splitVoice(accompaniment, "lower");
  const lowerUpperPitch = quantile(
    lower.voice.map((note) => note.pitchMidi),
    0.8,
    127,
  );
  if (
    lowerUpperPitch <= 55 &&
    hasIndependentVoice(lower.voice, lower.accompaniment)
  ) {
    separated.push({ role: "bass", notes: lower.voice });
    accompaniment = lower.accompaniment;
  }

  const upper = splitVoice(accompaniment, "upper");
  if (hasIndependentVoice(upper.voice, upper.accompaniment)) {
    separated.push({ role: "lead", notes: upper.voice });
    accompaniment = upper.accompaniment;
  }
  if (accompaniment.length) {
    separated.unshift({ role: "accompaniment", notes: accompaniment });
  }

  return {
    tracks: separated.map(({ role, notes: roleNotes }) =>
      makeLikelyTrack(role, roleNotes, samples, sampleRate),
    ),
    inferred: true,
  };
}

export function annotateTrackNotes(track: InstrumentTrack) {
  return track.notes.map((note) => ({
    ...note,
    instrumentId: track.id,
    instrumentName: track.name,
    instrumentProgram: track.midiProgram,
    instrumentProfileId: track.profileId,
    instrumentMonophonic: track.monophonic,
  }));
}
