import type { AdaptiveNote, ResolvedTranscriptionMode } from "./transcription-accuracy";
import type {
  InstrumentProfileId,
  ResolvedInstrumentProfileId,
} from "./instrument-polyphony";

export const INSTRUMENT_SETUP_OPTIONS = [
  {
    id: "auto",
    label: "Automatic · split musical roles",
    description:
      "Finds a separate lead and accompaniment when their note patterns clearly differ.",
  },
  {
    id: "solo",
    label: "Single · voice / solo",
    description: "Writes one monophonic lead track.",
  },
  {
    id: "bass",
    label: "Single · bass",
    description: "Writes one bass track with room for an occasional double-stop.",
  },
  {
    id: "guitar",
    label: "Single · guitar",
    description: "Writes one guitar track with no more than six simultaneous strings.",
  },
  {
    id: "piano",
    label: "Single · piano / keys",
    description: "Writes one piano track targeting six notes with a maximum of ten.",
  },
  {
    id: "ensemble",
    label: "Single · ensemble",
    description: "Writes one denser ensemble track.",
  },
  {
    id: "piano-trumpet",
    label: "Two tracks · piano + trumpet",
    description:
      "Assigns the upper monophonic line to trumpet and the remaining notes to piano.",
  },
  {
    id: "piano-bass",
    label: "Two tracks · piano + bass",
    description:
      "Assigns the lower monophonic line to bass and the remaining notes to piano.",
  },
] as const;

export type InstrumentSetupId =
  (typeof INSTRUMENT_SETUP_OPTIONS)[number]["id"];

export type InstrumentTrack = {
  id: string;
  name: string;
  midiProgram: number;
  profileId: ResolvedInstrumentProfileId;
  mode: ResolvedTranscriptionMode;
  monophonic: boolean;
  notes: AdaptiveNote[];
};

const SINGLE_INSTRUMENTS: Record<
  ResolvedInstrumentProfileId,
  Omit<InstrumentTrack, "notes" | "mode">
> = {
  solo: {
    id: "solo",
    name: "Solo lead",
    midiProgram: 73,
    profileId: "solo",
    monophonic: true,
  },
  bass: {
    id: "bass",
    name: "Fingered bass",
    midiProgram: 33,
    profileId: "bass",
    monophonic: true,
  },
  guitar: {
    id: "guitar",
    name: "Steel guitar",
    midiProgram: 25,
    profileId: "guitar",
    monophonic: false,
  },
  piano: {
    id: "piano",
    name: "Acoustic piano",
    midiProgram: 0,
    profileId: "piano",
    monophonic: false,
  },
  ensemble: {
    id: "ensemble",
    name: "String ensemble",
    midiProgram: 48,
    profileId: "ensemble",
    monophonic: false,
  },
};

const TRUMPET_TRACK: Omit<InstrumentTrack, "notes" | "mode"> = {
  id: "trumpet",
  name: "Trumpet",
  midiProgram: 56,
  profileId: "solo",
  monophonic: true,
};

const AUTOMATIC_LEAD_TRACK: Omit<InstrumentTrack, "notes" | "mode"> = {
  id: "lead",
  name: "Solo lead",
  midiProgram: 80,
  profileId: "solo",
  monophonic: true,
};

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

/**
 * Selects one credible, non-overlapping outer voice. This is musical-role
 * separation rather than a timbre claim: an explicit setup supplies the exact
 * General MIDI instrument when the listener knows it.
 */
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

function hasIndependentLead(
  lead: AdaptiveNote[],
  accompaniment: AdaptiveNote[],
) {
  if (lead.length < 3 || accompaniment.length < 3) return false;
  const independentOnsets = lead.filter(
    (leadNote) =>
      accompaniment.every(
        (note) =>
          Math.abs(note.startTimeSeconds - leadNote.startTimeSeconds) > 0.06,
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
  return accompanimentHasChords && independentOnsets / lead.length >= 0.34;
}

function makeTrack(
  definition: Omit<InstrumentTrack, "notes" | "mode">,
  notes: AdaptiveNote[],
  mode: ResolvedTranscriptionMode,
): InstrumentTrack {
  return { ...definition, notes, mode };
}

export function arrangeInstrumentTracks(
  notes: AdaptiveNote[],
  requested: InstrumentSetupId,
  mode: ResolvedTranscriptionMode,
) {
  if (requested === "piano-trumpet" || requested === "piano-bass") {
    const isTrumpet = requested === "piano-trumpet";
    const { voice, accompaniment } = splitVoice(
      notes,
      isTrumpet ? "upper" : "lower",
    );
    const voiceDefinition = isTrumpet
      ? TRUMPET_TRACK
      : SINGLE_INSTRUMENTS.bass;
    return {
      tracks: [
        makeTrack(SINGLE_INSTRUMENTS.piano, accompaniment, "chords"),
        makeTrack(voiceDefinition, voice, "melody"),
      ].filter((track) => track.notes.length),
      inferred: false,
    };
  }

  if (requested !== "auto") {
    return {
      tracks: [
        makeTrack(
          SINGLE_INSTRUMENTS[requested as ResolvedInstrumentProfileId],
          notes,
          mode,
        ),
      ],
      inferred: false,
    };
  }

  if (mode === "chords") {
    const { voice, accompaniment } = splitVoice(notes, "upper");
    if (hasIndependentLead(voice, accompaniment)) {
      return {
        tracks: [
          makeTrack(SINGLE_INSTRUMENTS.piano, accompaniment, "chords"),
          makeTrack(AUTOMATIC_LEAD_TRACK, voice, "melody"),
        ],
        inferred: true,
      };
    }
    return {
      tracks: [makeTrack(SINGLE_INSTRUMENTS.piano, notes, "chords")],
      inferred: true,
    };
  }

  const pitches = [...notes]
    .map((note) => note.pitchMidi)
    .sort((left, right) => left - right);
  const upperPitch = pitches[Math.floor(Math.max(0, pitches.length - 1) * 0.8)] ?? 60;
  const profileId: ResolvedInstrumentProfileId =
    upperPitch <= 55 ? "bass" : "solo";
  return {
    tracks: [makeTrack(SINGLE_INSTRUMENTS[profileId], notes, "melody")],
    inferred: true,
  };
}

export function annotateTrackNotes(track: InstrumentTrack) {
  return track.notes.map((note) => ({
    ...note,
    instrumentId: track.id,
    instrumentName: track.name,
    instrumentProgram: track.midiProgram,
    instrumentProfileId: track.profileId as InstrumentProfileId,
    instrumentMonophonic: track.monophonic,
  }));
}
