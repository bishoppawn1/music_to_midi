"use client";

import { FormEvent, useRef, useState } from "react";
import {
  getDetectionSettings,
  PITCH_RANGE_OPTIONS,
  type PitchRangeId,
  recoverPitchEdges,
  SENSITIVITY_OPTIONS,
  type SensitivityId,
} from "./detection-settings";
import { makeDownloadFilename } from "./download-filename";
import { cleanRetriggers, type CleanNote } from "./note-cleanup";
import {
  applyNoteDirection,
  NOTE_DIRECTION_OPTIONS,
  type NoteDirection,
} from "./note-order";

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
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
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

async function resampleToMono(buffer: AudioBuffer) {
  const length = Math.ceil(buffer.duration * SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

async function makeMidi(notes: CleanNote[]) {
  const { Midi } = await import("@tonejs/midi");
  const midi = new Midi();
  midi.header.setTempo(120);
  const track = midi.addTrack();
  track.name = "Link to MIDI transcription";
  track.instrument.number = 0;
  for (const note of notes) {
    track.addNote({
      midi: note.pitchMidi,
      time: Math.max(0, note.startTimeSeconds),
      duration: Math.max(0.03, note.durationSeconds),
      velocity: Math.min(1, Math.max(0.08, note.amplitude)),
    });
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
  const [noteDirection, setNoteDirection] = useState<NoteDirection>("forward");
  const [captureSeconds, setCaptureSeconds] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const captureRef = useRef<CaptureSession | null>(null);
  const previewContext = useRef<AudioContext | null>(null);
  const previewNodes = useRef<AudioScheduledSourceNode[]>([]);

  const busy = ["sharing", "recording", "decoding", "listening", "cleaning"].includes(phase);

  function stopPreview() {
    for (const node of previewNodes.current) {
      try {
        node.stop();
      } catch {
        // A node that already ended needs no further cleanup.
      }
    }
    previewNodes.current = [];
    if (previewContext.current) void previewContext.current.close();
    previewContext.current = null;
    setIsPlaying(false);
  }

  function playPreview() {
    if (!result || isPlaying) {
      stopPreview();
      return;
    }
    const context = new AudioContext();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = 0.18;
    master.connect(compressor);
    compressor.connect(context.destination);
    const base = context.currentTime + 0.08;
    let finalTime = base;

    for (const note of result.notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = base + note.startTimeSeconds;
      const duration = Math.max(0.04, note.durationSeconds);
      const level = Math.min(0.18, Math.max(0.025, note.amplitude * 0.13));
      oscillator.type = "triangle";
      oscillator.frequency.value = 440 * 2 ** ((note.pitchMidi - 69) / 12);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
      previewNodes.current.push(oscillator);
      finalTime = Math.max(finalTime, start + duration);
    }

    previewContext.current = context;
    setIsPlaying(true);
    window.setTimeout(() => stopPreview(), Math.max(0, finalTime - context.currentTime) * 1000 + 100);
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
      const samples = await resampleToMono(decoded);
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
      const recoveredFrames = recoverPitchEdges(frames, pitchRange);
      const recoveredOnsets = recoverPitchEdges(onsets, pitchRange);
      const frameNotes = basicPitchModule.outputToNotesPoly(
        recoveredFrames,
        recoveredOnsets,
        detection.onsetThreshold,
        detection.frameThreshold,
        detection.minNoteFrames,
        true,
        detection.maxFrequency,
        detection.minFrequency,
      );
      const timedNotes = basicPitchModule.noteFramesToTime(
        basicPitchModule.addPitchBendsToNoteEvents(contours, frameNotes),
      );
      const rawNotes = timedNotes.map((note, index) => ({
        startTimeSeconds: note.startTimeSeconds,
        durationSeconds: note.durationSeconds,
        pitchMidi: note.pitchMidi,
        amplitude: note.amplitude,
        onsetConfidence:
          recoveredOnsets[frameNotes[index].startFrame]?.[
            frameNotes[index].pitchMidi - 21
          ] ?? 0,
      }));
      const cleaned = cleanRetriggers(rawNotes, samples);
      if (!cleaned.notes.length) throw new Error("No clear musical notes were detected.");

      const directedNotes = applyNoteDirection(cleaned.notes, noteDirection);
      const isReversed = noteDirection === "reverse";
      const midiBytes = await makeMidi(directedNotes);
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
      });
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
          </div>
          <div className="form-foot">
            <span>
              {SENSITIVITY_OPTIONS.find((option) => option.id === sensitivity)?.description}{" "}
              {PITCH_RANGE_OPTIONS.find((option) => option.id === pitchRange)?.description}{" "}
              {NOTE_DIRECTION_OPTIONS.find((option) => option.id === noteDirection)?.description}
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
                  {result.directionLabel} · {result.merged} duplicate-looking retriggers joined
                </p>
              </div>
              <div className="result-actions">
                <button type="button" className="preview-button" onClick={playPreview}>
                  {isPlaying ? "Stop preview" : "Play preview"}
                </button>
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
