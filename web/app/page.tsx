"use client";

import { FormEvent, useRef, useState } from "react";
import { prepareAudioChannels } from "./audio-preprocessing";
import {
  getDetectionSettings,
  PITCH_RANGE_OPTIONS,
  type PitchRangeId,
  recoverPitchEdges,
  SENSITIVITY_OPTIONS,
  type SensitivityId,
} from "./detection-settings";
import { makeDownloadFilename } from "./download-filename";
import {
  addNoteAt,
  deleteNote,
  transposeNote,
} from "./note-editing";
import {
  cleanRetriggers,
  hasFreshAttack,
  type CleanNote,
} from "./note-cleanup";
import {
  applyNoteDirection,
  NOTE_DIRECTION_OPTIONS,
  type NoteDirection,
} from "./note-order";
import {
  midiVelocity,
  PREVIEW_MASTER_GAIN,
  previewNoteGain,
} from "./playback-levels";
import {
  clampPreviewSpeed,
  clampPreviewTime,
  MAX_PREVIEW_SPEED,
  MIN_PREVIEW_SPEED,
  notesForSchedulingWindow,
  previewPositionAt,
  previewDuration,
  songTimeToContextTime,
} from "./preview-timeline";
import {
  adaptiveDecodeSettings,
  applyTranscriptionMode,
  fuseAdaptivePasses,
  globalTuningBend,
  keepConfidentCandidates,
  pitchBendToMidiValue,
  smoothPitchBends,
  TRANSCRIPTION_MODE_OPTIONS,
  type ResolvedTranscriptionMode,
  type TranscriptionMode,
} from "./transcription-accuracy";

type Phase =
  | "idle"
  | "armed"
  | "sharing"
  | "recording"
  | "decoding"
  | "listening"
  | "cleaning"
  | "ready"
  | "error";

type Result = {
  title: string;
  duration: number;
  notes: CleanNote[];
  merged: number;
  midiUrl: string;
  downloadTitle: string;
  directionLabel: string;
  resolvedMode: ResolvedTranscriptionMode;
};

type CaptureSession = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  title: string;
  startedAt: number;
  intervalId: number;
  finished: boolean;
};

const SAMPLE_RATE = 22_050;
const MAX_CAPTURE_SECONDS = 10 * 60;
const PUBLIC_BASE = import.meta.env.BASE_URL || "/";
const PROCESS_STEPS: Array<{ phase: Phase; label: string }> = [
  { phase: "decoding", label: "Prepare sound" },
  { phase: "listening", label: "Hear the notes" },
  { phase: "cleaning", label: "Clean repeats" },
  { phase: "ready", label: "Make MIDI" },
];

function phaseIndex(phase: Phase) {
  return PROCESS_STEPS.findIndex((step) => step.phase === phase);
}

function formatDuration(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function parseYouTubeUrl(value: string) {
  const parsed = new URL(value.trim());
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
    throw new Error("not youtube");
  }

  let videoId = "";
  if (host === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else if (parsed.pathname === "/watch") {
    videoId = parsed.searchParams.get("v") || "";
  } else {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live"].includes(parts[0])) videoId = parts[1] || "";
  }

  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) throw new Error("missing video id");
  return { parsed, videoId };
}

function youtubeEmbedUrl(videoId: string) {
  const parameters = new URLSearchParams({
    playsinline: "1",
    rel: "0",
  });
  return `https://www.youtube.com/embed/${videoId}?${parameters}`;
}

function recorderOptions(): MediaRecorderOptions | undefined {
  const mimeType = [
    "audio/webm;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/webm",
    "audio/mp4",
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : undefined;
}

function bendFrequency(pitchMidi: number, bend = 0) {
  return 440 * 2 ** ((pitchMidi + bend / 3 - 69) / 12);
}

async function makeMidi(
  notes: CleanNote[],
  resolvedMode: ResolvedTranscriptionMode,
) {
  const { Midi } = await import("@tonejs/midi");
  const midi = new Midi();
  midi.header.setTempo(120);
  const track = midi.addTrack();
  track.name = "Link to MIDI transcription";
  track.instrument.number = 0;
  const tuningBend = globalTuningBend(notes);
  if (tuningBend) track.addPitchBend({ time: 0, value: tuningBend });
  for (const note of notes) {
    track.addNote({
      midi: note.pitchMidi,
      time: Math.max(0, note.startTimeSeconds),
      duration: Math.max(0.03, note.durationSeconds),
      velocity: midiVelocity(note.amplitude),
    });
    if (resolvedMode === "melody" && note.pitchBends?.length) {
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
  return midi.toArray();
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceVideoId, setSourceVideoId] = useState("");
  const [sensitivity, setSensitivity] = useState<SensitivityId>("balanced");
  const [pitchRange, setPitchRange] = useState<PitchRangeId>("full");
  const [transcriptionMode, setTranscriptionMode] =
    useState<TranscriptionMode>("auto");
  const [noteDirection, setNoteDirection] = useState<NoteDirection>("forward");
  const [captureSeconds, setCaptureSeconds] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewSpeed, setPreviewSpeed] = useState(1);
  const [selectedNoteIndex, setSelectedNoteIndex] = useState<number | null>(null);
  const captureRef = useRef<CaptureSession | null>(null);
  const previewContext = useRef<AudioContext | null>(null);
  const previewNodes = useRef(new Set<AudioScheduledSourceNode>());
  const previewInterval = useRef<number | null>(null);

  const busy = ["sharing", "recording", "decoding", "listening", "cleaning"].includes(phase);

  function stopPreview(resetPosition = false) {
    if (previewInterval.current !== null) {
      window.clearInterval(previewInterval.current);
      previewInterval.current = null;
    }
    for (const node of previewNodes.current) {
      try {
        node.stop();
      } catch {
        // A node that already ended needs no further cleanup.
      }
    }
    previewNodes.current.clear();
    if (previewContext.current) void previewContext.current.close();
    previewContext.current = null;
    setIsPlaying(false);
    if (resetPosition) setPreviewTime(0);
  }

  function startPreview(requestedOffset: number, requestedSpeed = previewSpeed) {
    if (!result) return;
    stopPreview();
    const playbackRate = clampPreviewSpeed(requestedSpeed);
    const previewNotes = result.notes;
    const durationTotal = previewDuration(previewNotes, result.duration);
    const offset =
      requestedOffset >= durationTotal - 0.02
        ? 0
        : clampPreviewTime(requestedOffset, durationTotal);
    const context = new AudioContext();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = PREVIEW_MASTER_GAIN;
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    master.connect(compressor);
    compressor.connect(context.destination);
    const base = context.currentTime + 0.06;

    function scheduleNote(note: CleanNote) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteEnd = note.startTimeSeconds + note.durationSeconds;
      const audibleStart = Math.max(offset, note.startTimeSeconds);
      const start = songTimeToContextTime(
        audibleStart,
        offset,
        base,
        playbackRate,
      );
      const duration = Math.max(
        0.015,
        (noteEnd - audibleStart) / playbackRate,
      );
      const level = previewNoteGain(note.amplitude);
      const bends = smoothPitchBends(note.pitchBends ?? []);
      const bendStartIndex = bends.length
        ? Math.min(
            bends.length - 1,
            Math.floor(
              ((audibleStart - note.startTimeSeconds) / note.durationSeconds) *
                bends.length,
            ),
          )
        : 0;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(
        bendFrequency(note.pitchMidi, bends[bendStartIndex] ?? 0),
        start,
      );
      if (bends.length) {
        const bendStep = Math.max(1, Math.ceil(bends.length / 48));
        for (
          let index = bendStartIndex + bendStep;
          index < bends.length;
          index += bendStep
        ) {
          const bendTime = songTimeToContextTime(
            note.startTimeSeconds +
              note.durationSeconds * (index / bends.length),
            offset,
            base,
            playbackRate,
          );
          if (bendTime >= start) {
            oscillator.frequency.linearRampToValueAtTime(
              bendFrequency(note.pitchMidi, bends[index]),
              bendTime,
            );
          }
        }
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(
        level,
        start + Math.min(0.012, duration * 0.35),
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
      previewNodes.current.add(oscillator);
      oscillator.addEventListener(
        "ended",
        () => previewNodes.current.delete(oscillator),
        { once: true },
      );
    }

    function scheduleWindow(
      windowStart: number,
      windowEnd: number,
      includeAlreadyPlaying = false,
    ) {
      for (const note of notesForSchedulingWindow(
        previewNotes,
        windowStart,
        windowEnd,
        includeAlreadyPlaying,
      )) {
        scheduleNote(note);
      }
    }

    let scheduledThrough = Math.min(
      durationTotal,
      offset + 12 * playbackRate,
    );
    scheduleWindow(offset, scheduledThrough, true);
    previewContext.current = context;
    setPreviewTime(offset);
    setIsPlaying(true);
    previewInterval.current = window.setInterval(() => {
      const position = Math.min(
        durationTotal,
        previewPositionAt(
          context.currentTime,
          base,
          offset,
          playbackRate,
        ),
      );
      setPreviewTime(position);
      if (
        scheduledThrough < durationTotal &&
        scheduledThrough < position + 8 * playbackRate
      ) {
        const nextWindowEnd = Math.min(
          durationTotal,
          position + 12 * playbackRate,
        );
        scheduleWindow(scheduledThrough, nextWindowEnd);
        scheduledThrough = nextWindowEnd;
      }
      if (position >= durationTotal) {
        stopPreview();
        setPreviewTime(durationTotal);
      }
    }, 50);
  }

  function togglePreview() {
    if (isPlaying) {
      stopPreview();
    } else {
      startPreview(previewTime);
    }
  }

  function seekPreview(time: number) {
    if (!result) return;
    const wasPlaying = isPlaying;
    stopPreview();
    const nextTime = clampPreviewTime(
      time,
      previewDuration(result.notes, result.duration),
    );
    setPreviewTime(nextTime);
    if (wasPlaying) startPreview(nextTime);
  }

  function changePreviewSpeed(speed: number) {
    const nextSpeed = clampPreviewSpeed(speed);
    if (nextSpeed === previewSpeed) return;
    const wasPlaying = isPlaying;
    stopPreview();
    setPreviewSpeed(nextSpeed);
    if (wasPlaying) startPreview(previewTime, nextSpeed);
  }

  function reset() {
    stopPreview();
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture) {
      capture.finished = true;
      window.clearInterval(capture.intervalId);
      if (capture.recorder.state !== "inactive") capture.recorder.stop();
      capture.stream.getTracks().forEach((track) => track.stop());
    }
    if (result?.midiUrl) URL.revokeObjectURL(result.midiUrl);
    setResult(null);
    setSelectedNoteIndex(null);
    setPreviewTime(0);
    setProgress(0);
    setMessage("");
    setSourceTitle("");
    setSourceUrl("");
    setSourceVideoId("");
    setCaptureSeconds(0);
    setPhase("idle");
  }

  function loadVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    stopPreview();
    if (result?.midiUrl) URL.revokeObjectURL(result.midiUrl);
    setResult(null);
    setSelectedNoteIndex(null);
    setPreviewTime(0);
    setMessage("");
    setProgress(0);

    try {
      const { parsed, videoId } = parseYouTubeUrl(url);
      setSourceTitle(`YouTube capture ${videoId}`);
      setSourceUrl(parsed.toString());
      setSourceVideoId(videoId);
      setPhase("armed");
    } catch {
      setPhase("error");
      setMessage("Paste a complete YouTube or youtu.be link.");
    }
  }

  async function transcribeCapture(blob: Blob, title: string) {
    let audioContext: AudioContext | null = null;
    try {
      setPhase("decoding");
      setMessage("");
      const audioData = await blob.arrayBuffer();
      audioContext = new AudioContext();
      const decoded = await audioContext.decodeAudioData(audioData.slice(0));
      if (decoded.duration < 0.5) {
        throw new Error("The capture was too short. Record at least a few seconds of music.");
      }
      const samples = prepareAudioChannels(
        Array.from(
          { length: decoded.numberOfChannels },
          (_, index) => new Float32Array(decoded.getChannelData(index)),
        ),
        decoded.sampleRate,
        SAMPLE_RATE,
      );
      await audioContext.close();
      audioContext = null;

      setPhase("listening");
      const basicPitchModule = await import("@spotify/basic-pitch");
      const frames: number[][] = [];
      const onsets: number[][] = [];
      const contours: number[][] = [];
      const basicPitch = new basicPitchModule.BasicPitch(`${PUBLIC_BASE}model/model.json`);
      await basicPitch.evaluateModel(
        samples,
        (newFrames, newOnsets, newContours) => {
          frames.push(...newFrames);
          onsets.push(...newOnsets);
          contours.push(...newContours);
        },
        (value) => setProgress(Math.round(value * 100)),
      );

      setPhase("cleaning");
      const detection = getDetectionSettings(sensitivity, pitchRange);
      const recoveredFrames = recoverPitchEdges(frames, pitchRange, 1.2);
      const recoveredOnsets = recoverPitchEdges(onsets, pitchRange, 1.08);
      const passes = adaptiveDecodeSettings(detection).map((pass) => {
        const frameNotes = basicPitchModule.outputToNotesPoly(
          recoveredFrames,
          recoveredOnsets,
          pass.onsetThreshold,
          pass.frameThreshold,
          pass.minNoteFrames,
          pass.inferOnsets,
          detection.maxFrequency,
          detection.minFrequency,
        );
        const timedNotes = basicPitchModule.noteFramesToTime(
          basicPitchModule.addPitchBendsToNoteEvents(contours, frameNotes),
        );
        return timedNotes.map((note, index) => ({
          startTimeSeconds: note.startTimeSeconds,
          durationSeconds: note.durationSeconds,
          pitchMidi: note.pitchMidi,
          amplitude: note.amplitude,
          pitchBends: note.pitchBends,
          onsetConfidence:
            recoveredOnsets[frameNotes[index].startFrame]?.[
              frameNotes[index].pitchMidi - 21
            ] ?? 0,
        }));
      });
      const fused = fuseAdaptivePasses(passes);
      const confident = keepConfidentCandidates(
        fused,
        (time) => hasFreshAttack(samples, time, SAMPLE_RATE),
      );
      const modeApplied = applyTranscriptionMode(confident, transcriptionMode);
      const cleaned = cleanRetriggers(modeApplied.notes, samples);
      if (!cleaned.notes.length) throw new Error("No clear musical notes were detected.");

      const directedNotes = applyNoteDirection(cleaned.notes, noteDirection);
      const isReversed = noteDirection === "reverse";
      const midiBytes = await makeMidi(directedNotes, modeApplied.resolvedMode);
      const midiData = Uint8Array.from(midiBytes);
      const midiBlob = new Blob([midiData.buffer], { type: "audio/midi" });
      setResult({
        title,
        duration: decoded.duration,
        notes: directedNotes,
        merged: cleaned.merged,
        midiUrl: URL.createObjectURL(midiBlob),
        downloadTitle: isReversed ? `${title}-reverse` : title,
        directionLabel: isReversed ? "reverse order" : "forward order",
        resolvedMode: modeApplied.resolvedMode,
      });
      setPreviewTime(0);
      setSelectedNoteIndex(null);
      setProgress(100);
      setPhase("ready");
    } catch (error) {
      if (audioContext) await audioContext.close();
      setPhase("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The captured audio could not be converted.",
      );
    }
  }

  async function finalizeCapture(session: CaptureSession) {
    if (session.finished) return;
    session.finished = true;
    window.clearInterval(session.intervalId);
    session.stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(session.chunks, {
      type: session.recorder.mimeType || "audio/webm",
    });
    if (blob.size < 1024) {
      setPhase("error");
      setMessage("No tab audio was captured. Make sure “Share tab audio” is enabled.");
      return;
    }
    await transcribeCapture(blob, session.title);
  }

  async function replaceResultNotes(notes: CleanNote[]) {
    if (!result) return;
    stopPreview();
    const midiBytes = await makeMidi(notes, result.resolvedMode);
    const midiData = Uint8Array.from(midiBytes);
    const midiBlob = new Blob([midiData.buffer], { type: "audio/midi" });
    const midiUrl = URL.createObjectURL(midiBlob);
    URL.revokeObjectURL(result.midiUrl);
    setResult({ ...result, notes, midiUrl });
    setPreviewTime((time) =>
      clampPreviewTime(time, previewDuration(notes, result.duration)),
    );
  }

  function changeSelectedPitch(semitones: number) {
    if (!result || selectedNoteIndex === null) return;
    void replaceResultNotes(
      transposeNote(result.notes, selectedNoteIndex, semitones),
    );
  }

  function removeSelectedNote() {
    if (!result || selectedNoteIndex === null) return;
    void replaceResultNotes(deleteNote(result.notes, selectedNoteIndex));
    setSelectedNoteIndex(null);
  }

  function addNoteAtPreview() {
    if (!result) return;
    void replaceResultNotes(addNoteAt(result.notes, previewTime));
    setSelectedNoteIndex(null);
  }

  function stopCapture() {
    const session = captureRef.current;
    if (!session) return;
    captureRef.current = null;
    window.clearInterval(session.intervalId);
    if (session.recorder.state !== "inactive") {
      session.recorder.stop();
    } else {
      void finalizeCapture(session);
    }
  }

  async function startCapture() {
    stopPreview();
    setMessage("");
    setCaptureSeconds(0);

    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
      setPhase("error");
      setMessage("This browser does not support tab-audio capture. Try a current desktop browser.");
      return;
    }

    try {
      setPhase("sharing");
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: false },
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "exclude",
        monitorTypeSurfaces: "exclude",
      } as DisplayMediaStreamOptions);

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("No audio was shared. Select this tab and enable “Share tab audio”.");
      }

      const audioStream = new MediaStream(audioTracks);
      const options = recorderOptions();
      const recorder = options
        ? new MediaRecorder(audioStream, options)
        : new MediaRecorder(audioStream);
      const session: CaptureSession = {
        recorder,
        stream,
        chunks: [],
        title: sourceTitle || "YouTube tab capture",
        startedAt: Date.now(),
        intervalId: 0,
        finished: false,
      };

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) session.chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => void finalizeCapture(session), { once: true });
      stream.getTracks().forEach((track) => {
        track.addEventListener(
          "ended",
          () => {
            if (captureRef.current === session) stopCapture();
          },
          { once: true },
        );
      });

      captureRef.current = session;
      recorder.start(1000);
      session.intervalId = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - session.startedAt) / 1000);
        setCaptureSeconds(seconds);
        if (seconds >= MAX_CAPTURE_SECONDS) stopCapture();
      }, 250);
      setPhase("recording");
    } catch (error) {
      if (
        error instanceof DOMException &&
        ["AbortError", "NotAllowedError"].includes(error.name)
      ) {
        setPhase("armed");
        setMessage("Sharing was canceled. Click the capture button when you are ready.");
        return;
      }
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Tab sharing could not start.");
    }
  }

  const currentStep = phaseIndex(phase);
  const resultPreviewDuration = result
    ? previewDuration(result.notes, result.duration)
    : 0;
  const editorPitches = result?.notes.map((note) => note.pitchMidi) ?? [];
  const editorMinimumPitch = editorPitches.length
    ? Math.max(21, Math.min(...editorPitches) - 2)
    : 21;
  const editorMaximumPitch = editorPitches.length
    ? Math.min(108, Math.max(...editorPitches) + 2)
    : 108;
  const editorPitchSpan = Math.max(
    1,
    editorMaximumPitch - editorMinimumPitch + 1,
  );

  return (
    <main>
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Link to MIDI home">
          <span className="brand-mark" aria-hidden="true">↗</span>
          LINK TO MIDI
        </a>
        <span className="local-badge">SINGLE-TAB CAPTURE</span>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> AUDIO TRANSCRIPTION, WITHOUT A SERVER</div>
        <h1>Play it here.<br /><em>Keep the music.</em></h1>
        <p className="lede">
          Turn an authorized YouTube performance into an editable MIDI file.
          The player, capture, and transcription stay together in one browser tab.
        </p>

        <form className="converter" onSubmit={loadVideo}>
          <label htmlFor="youtube-url">YouTube URL</label>
          <div className="input-row">
            <input
              id="youtube-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://youtu.be/..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={busy}
              required
            />
            <button type="submit" disabled={busy}>
              Load video
              <span aria-hidden="true">↓</span>
            </button>
          </div>
          <div className="detection-controls">
            <label>
              <span>Detection detail</span>
              <select
                value={sensitivity}
                onChange={(event) => setSensitivity(event.target.value as SensitivityId)}
                disabled={busy}
              >
                {SENSITIVITY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Pitch focus</span>
              <select
                value={pitchRange}
                onChange={(event) => setPitchRange(event.target.value as PitchRangeId)}
                disabled={busy}
              >
                {PITCH_RANGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Note direction</span>
              <select
                value={noteDirection}
                onChange={(event) => setNoteDirection(event.target.value as NoteDirection)}
                disabled={busy}
              >
                {NOTE_DIRECTION_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Transcription mode</span>
              <select
                value={transcriptionMode}
                onChange={(event) =>
                  setTranscriptionMode(event.target.value as TranscriptionMode)
                }
                disabled={busy}
              >
                {TRANSCRIPTION_MODE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section
            className="mode-guide"
            aria-labelledby="mode-guide-title"
          >
            <h2 id="mode-guide-title">What do these music modes mean?</h2>
            <div>
              {TRANSCRIPTION_MODE_OPTIONS.map((option) => (
                <article
                  key={option.id}
                  className={transcriptionMode === option.id ? "selected" : ""}
                >
                  <h3>{option.name}</h3>
                  <p>{option.description}</p>
                </article>
              ))}
            </div>
          </section>
          <div className="form-foot">
            <span>
              {SENSITIVITY_OPTIONS.find((option) => option.id === sensitivity)?.description}{" "}
              {PITCH_RANGE_OPTIONS.find((option) => option.id === pitchRange)?.description}{" "}
              {NOTE_DIRECTION_OPTIONS.find((option) => option.id === noteDirection)?.description}{" "}
              {TRANSCRIPTION_MODE_OPTIONS.find((option) => option.id === transcriptionMode)?.description}
            </span>
            <span>Single-tab audio capture · up to 10 minutes</span>
          </div>
        </form>

        {["armed", "sharing", "recording"].includes(phase) && sourceVideoId && (
          <section className="video-stage" aria-label="YouTube source video">
            <div className="video-frame">
              <iframe
                src={youtubeEmbedUrl(sourceVideoId)}
                title="YouTube video player"
                allow="autoplay; encrypted-media; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
            <div className="video-caption">
              <span>YOUTUBE SOURCE</span>
              <span>Cue the music before starting capture</span>
            </div>
          </section>
        )}

        {(phase === "armed" || phase === "sharing") && (
          <section className="capture-guide" aria-live="polite">
            <div>
              <div className="capture-kicker">NEXT: CAPTURE THIS TAB</div>
              <h2>{phase === "sharing" ? "Choose this Link to MIDI tab." : "Cue the video at the start."}</h2>
              <ol>
                <li>Pause the player just before the music you want.</li>
                <li>Click capture, select this tab, and keep <strong>Share tab audio</strong> enabled.</li>
                <li>Play the video above, then stop the capture here.</li>
              </ol>
              {message && <p className="capture-message">{message}</p>}
            </div>
            <div className="capture-actions">
              <button
                type="button"
                className="capture-button"
                onClick={startCapture}
                disabled={phase === "sharing"}
              >
                {phase === "sharing" ? "Choose this tab…" : "Capture this tab"}
              </button>
              <a
                className="text-button"
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open on YouTube instead ↗
              </a>
              <button type="button" className="text-button" onClick={reset}>
                Start over
              </button>
            </div>
          </section>
        )}

        {phase === "recording" && (
          <section className="recording-card" aria-live="polite">
            <div>
              <div className="recording-kicker"><span /> RECORDING TAB AUDIO</div>
              <h2>{formatDuration(captureSeconds)}</h2>
              <p>Play the video above. Stop when the music you want has finished.</p>
            </div>
            <button type="button" className="stop-button" onClick={stopCapture}>
              Stop and make MIDI
            </button>
          </section>
        )}

        {["decoding", "listening", "cleaning", "ready"].includes(phase) && (
          <section className="process-panel" aria-live="polite">
            <ol className="steps">
              {PROCESS_STEPS.map((step, index) => (
                <li
                  key={step.phase}
                  className={
                    index < currentStep || phase === "ready"
                      ? "done"
                      : index === currentStep
                        ? "active"
                        : ""
                  }
                >
                  <span>{index < currentStep || phase === "ready" ? "✓" : index + 1}</span>
                  {step.label}
                </li>
              ))}
            </ol>
            {phase === "listening" && (
              <div className="progress-track" aria-label={`Transcription ${progress}% complete`}>
                <span style={{ width: `${progress}%` }} />
              </div>
            )}
          </section>
        )}

        {phase === "error" && (
          <section className="process-panel has-error" aria-live="polite">
            <div className="error-line">
              <span aria-hidden="true">!</span>
              <p>{message}</p>
              <button type="button" onClick={reset}>Try again</button>
            </div>
          </section>
        )}

        {phase === "ready" && result && (
          <section className="result-card" aria-labelledby="result-title">
            <div className="result-kicker">TRANSCRIPTION READY</div>
            <div className="result-heading">
              <div>
                <h2 id="result-title">{result.title}</h2>
                <p>
                  {result.notes.length} notes · {formatDuration(result.duration)} ·{" "}
                  {result.resolvedMode} mode · {result.directionLabel} ·{" "}
                  {result.merged} duplicate-looking retriggers joined
                </p>
              </div>
              <div className="result-actions">
                <a
                  className="download-button"
                  href={result.midiUrl}
                  download={makeDownloadFilename(result.downloadTitle)}
                  onClick={(event) => {
                    event.currentTarget.download = makeDownloadFilename(result.downloadTitle);
                  }}
                >
                  Download MIDI <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
            <div className="preview-player">
              <button
                type="button"
                className="preview-button"
                onClick={togglePreview}
                aria-label={isPlaying ? "Pause MIDI preview" : "Play MIDI preview"}
              >
                {isPlaying ? "Pause" : "Play"}
              </button>
              <div className="preview-timeline">
                <div className="preview-track" aria-hidden="true">
                  <span
                    style={{
                      width: `${
                        resultPreviewDuration
                          ? (previewTime / resultPreviewDuration) * 100
                          : 0
                      }%`,
                    }}
                  />
                  <i
                    style={{
                      left: `${
                        resultPreviewDuration
                          ? (previewTime / resultPreviewDuration) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max={resultPreviewDuration}
                  step="0.01"
                  value={previewTime}
                  onChange={(event) => seekPreview(Number(event.target.value))}
                  aria-label="Preview position"
                />
                <div className="preview-times">
                  <span>{formatDuration(previewTime)}</span>
                  <span>{formatDuration(resultPreviewDuration)}</span>
                </div>
              </div>
              <div
                className="playback-speed"
                aria-label="Preview playback speed controls"
              >
                <button
                  type="button"
                  onClick={() => changePreviewSpeed(previewSpeed - 0.1)}
                  disabled={previewSpeed <= MIN_PREVIEW_SPEED}
                  aria-label="Decrease preview speed"
                  title="Decrease preview speed"
                >
                  −
                </button>
                <label>
                  <span>Speed</span>
                  <input
                    type="range"
                    min={MIN_PREVIEW_SPEED}
                    max={MAX_PREVIEW_SPEED}
                    step="0.1"
                    value={previewSpeed}
                    onChange={(event) =>
                      changePreviewSpeed(Number(event.target.value))
                    }
                    aria-label="Preview playback speed"
                  />
                </label>
                <output aria-live="polite">{previewSpeed.toFixed(1)}×</output>
                <button
                  type="button"
                  onClick={() => changePreviewSpeed(previewSpeed + 0.1)}
                  disabled={previewSpeed >= MAX_PREVIEW_SPEED}
                  aria-label="Increase preview speed"
                  title="Increase preview speed"
                >
                  +
                </button>
              </div>
            </div>
            <section className="note-editor" aria-labelledby="note-editor-title">
              <div className="note-editor-head">
                <div>
                  <span>MANUAL CORRECTION</span>
                  <h3 id="note-editor-title">Fix individual notes</h3>
                </div>
                <div className="note-editor-actions">
                  <button
                    type="button"
                    onClick={() => changeSelectedPitch(-1)}
                    disabled={selectedNoteIndex === null}
                  >
                    Pitch −
                  </button>
                  <button
                    type="button"
                    onClick={() => changeSelectedPitch(1)}
                    disabled={selectedNoteIndex === null}
                  >
                    Pitch +
                  </button>
                  <button
                    type="button"
                    onClick={removeSelectedNote}
                    disabled={selectedNoteIndex === null}
                  >
                    Delete
                  </button>
                  <button type="button" onClick={addNoteAtPreview}>
                    Add at playhead
                  </button>
                </div>
              </div>
              <div
                className="piano-roll"
                aria-label="Detected notes. Select a note to correct it."
              >
                {result.notes.map((note, index) => (
                  <button
                    type="button"
                    className={selectedNoteIndex === index ? "selected" : ""}
                    key={`${note.startTimeSeconds}-${note.pitchMidi}-${index}`}
                    aria-label={`MIDI note ${note.pitchMidi} at ${formatDuration(note.startTimeSeconds)}`}
                    onClick={() => setSelectedNoteIndex(index)}
                    style={{
                      left: `${
                        resultPreviewDuration
                          ? (note.startTimeSeconds / resultPreviewDuration) * 100
                          : 0
                      }%`,
                      width: `${Math.max(
                        0.6,
                        resultPreviewDuration
                          ? (note.durationSeconds / resultPreviewDuration) * 100
                          : 1,
                      )}%`,
                      top: `${
                        ((editorMaximumPitch - note.pitchMidi) /
                          editorPitchSpan) *
                        100
                      }%`,
                    }}
                  />
                ))}
                <span
                  className="piano-roll-playhead"
                  aria-hidden="true"
                  style={{
                    left: `${
                      resultPreviewDuration
                        ? (previewTime / resultPreviewDuration) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p>
                Select a note to move it by a semitone or delete it. Move the
                preview bar, then add a missing note at that position.
              </p>
            </section>
          </section>
        )}
      </section>

      <section className="how-it-works" aria-labelledby="how-title">
        <div>
          <p className="section-number">01 / 03</p>
          <h2 id="how-title">One tab from link<br />to piano roll.</h2>
        </div>
        <div className="method-grid">
          <article>
            <span>01</span>
            <h3>Load</h3>
            <p>Paste the link and cue the embedded player at the beginning of the music.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Capture</h3>
            <p>Share this tab with audio, play the section, and stop when it is finished.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Edit</h3>
            <p>Preview and download a standard MIDI file without uploading the recording.</p>
          </article>
        </div>
      </section>

      <footer>
        <span>LINK TO MIDI</span>
        <p>Only capture media you have permission to use. Processing stays in your browser.</p>
      </footer>
    </main>
  );
}
