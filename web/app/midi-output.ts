import type { CleanNote } from "./note-cleanup.ts";
import { midiVelocity } from "./playback-levels.ts";
import {
  globalTuningBend,
  pitchBendToMidiValue,
  smoothPitchBends,
} from "./transcription-accuracy.ts";

export async function makeMultiTrackMidi(notes: CleanNote[]) {
  const midiModule = await import("@tonejs/midi");
  const Midi = midiModule.Midi ?? midiModule.default.Midi;
  const midi = new Midi();
  midi.header.setTempo(120);
  const notesByInstrument = new Map<string, CleanNote[]>();
  for (const note of notes) {
    const instrumentId = note.instrumentId ?? "piano";
    const group = notesByInstrument.get(instrumentId) ?? [];
    group.push(note);
    notesByInstrument.set(instrumentId, group);
  }

  Array.from(notesByInstrument.values()).forEach((instrumentNotes, trackIndex) => {
    const firstNote = instrumentNotes[0];
    const track = midi.addTrack();
    track.name = firstNote.instrumentName ?? "Acoustic piano";
    track.instrument.number = firstNote.instrumentProgram ?? 0;
    track.channel = trackIndex >= 9 ? trackIndex + 1 : trackIndex;
    const tuningBend = globalTuningBend(instrumentNotes);
    if (tuningBend) track.addPitchBend({ time: 0, value: tuningBend });

    for (const note of instrumentNotes) {
      track.addNote({
        midi: note.pitchMidi,
        time: Math.max(0, note.startTimeSeconds),
        duration: Math.max(0.03, note.durationSeconds),
        velocity: midiVelocity(note.amplitude),
      });
      if (note.instrumentMonophonic && note.pitchBends?.length) {
        const smoothedBends = smoothPitchBends(note.pitchBends);
        const step = Math.max(1, Math.ceil(smoothedBends.length / 48));
        for (let index = 0; index < smoothedBends.length; index += step) {
          track.addPitchBend({
            time:
              note.startTimeSeconds +
              note.durationSeconds * (index / smoothedBends.length),
            value: pitchBendToMidiValue(smoothedBends[index]),
          });
        }
        track.addPitchBend({
          time: note.startTimeSeconds + note.durationSeconds,
          value: tuningBend,
        });
      }
    }
  });
  return midi.toArray();
}
