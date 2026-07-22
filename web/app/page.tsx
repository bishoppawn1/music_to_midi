"use client";

import { FormEvent, useRef, useState } from "react";
import { cleanRetriggers, type CleanNote } from "./note-cleanup";

type Phase =
  | "idle"
  | "fetching"
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
  filename: string;
};

const SAMPLE_RATE = 22_050;
const STEPS: Array<{ phase: Phase; label: string }> = [
  { phase: "fetching", label: "Fetch audio" },
  { phase: "decoding", label: "Prepare sound" },
  { phase: "listening", label: "Hear the notes" },
  { phase: "cleaning", label: "Clean repeats" },
  { phase: "ready", label: "Make MIDI" },
];

function phaseIndex(phase: Phase) {
  return STEPS.findIndex((step) => step.phase === phase);
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function safeFilename(title: string) {
  const clean = title
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${clean || "transcription"}.mid`;
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
  const [result, setResult] = useState<Result | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const previewContext = useRef<AudioContext | null>(null);
  const previewNodes = useRef<AudioScheduledSourceNode[]>([]);

  const busy = !["idle", "ready", "error"].includes(phase);

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

  async function convert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    stopPreview();
    if (result?.midiUrl) URL.revokeObjectURL(result.midiUrl);
    setResult(null);
    setMessage("");
    setProgress(0);

    let parsed: URL;
    try {
      parsed = new URL(url.trim());
      const host = parsed.hostname.replace(/^www\./, "");
      if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
        throw new Error("not youtube");
      }
    } catch {
      setPhase("error");
      setMessage("Paste a complete YouTube or youtu.be link.");
      return;
    }

    let audioContext: AudioContext | null = null;
    try {
      setPhase("fetching");
      const response = await fetch(`/api/audio?url=${encodeURIComponent(parsed.toString())}`);
      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(problem?.error || "That video could not be opened.");
      }
      const audioData = await response.arrayBuffer();
      const encodedTitle = response.headers.get("x-video-title");
      const title = encodedTitle ? decodeURIComponent(encodedTitle) : "YouTube transcription";
      const duration = Number(response.headers.get("x-video-duration") || 0);

      setPhase("decoding");
      audioContext = new AudioContext();
      const decoded = await audioContext.decodeAudioData(audioData.slice(0));
      const samples = await resampleToMono(decoded);
      await audioContext.close();
      audioContext = null;

      setPhase("listening");
      const basicPitchModule = await import("@spotify/basic-pitch");
      const frames: number[][] = [];
      const onsets: number[][] = [];
      const contours: number[][] = [];
      const basicPitch = new basicPitchModule.BasicPitch("/model/model.json");
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
      const frameNotes = basicPitchModule.outputToNotesPoly(
        frames,
        onsets,
        0.62,
        0.25,
        11,
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
          onsets[frameNotes[index].startFrame]?.[frameNotes[index].pitchMidi - 21] ?? 0,
      }));
      const cleaned = cleanRetriggers(rawNotes, samples);
      if (!cleaned.notes.length) throw new Error("No clear musical notes were detected.");

      const midiBytes = await makeMidi(cleaned.notes);
      const midiBlob = new Blob([midiBytes], { type: "audio/midi" });
      setResult({
        title,
        duration: duration || decoded.duration,
        notes: cleaned.notes,
        merged: cleaned.merged,
        midiUrl: URL.createObjectURL(midiBlob),
        filename: safeFilename(title),
      });
      setProgress(100);
      setPhase("ready");
    } catch (error) {
      if (audioContext) await audioContext.close();
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Conversion stopped unexpectedly.");
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
        <span className="local-badge">RUNS IN YOUR BROWSER</span>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> AUDIO TRANSCRIPTION, WITHOUT THE SETUP</div>
        <h1>Paste the link.<br /><em>Keep the music.</em></h1>
        <p className="lede">
          Turn a public YouTube performance into an editable MIDI file. No app,
          no account, no command line.
        </p>

        <form className="converter" onSubmit={convert}>
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
              {busy ? "Listening…" : "Make MIDI"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
          <div className="form-foot">
            <span>Best with solo piano, guitar, voice, or other single instruments.</span>
            <span>Public videos · up to 10 minutes</span>
          </div>
        </form>

        {phase !== "idle" && (
          <section className={`process-panel ${phase === "error" ? "has-error" : ""}`} aria-live="polite">
            {phase === "error" ? (
              <div className="error-line">
                <span aria-hidden="true">!</span>
                <p>{message}</p>
                <button type="button" onClick={() => setPhase("idle")}>Try again</button>
              </div>
            ) : (
              <>
                <ol className="steps">
                  {STEPS.map((step, index) => (
                    <li
                      key={step.phase}
                      className={index < currentStep || phase === "ready" ? "done" : index === currentStep ? "active" : ""}
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
              </>
            )}
          </section>
        )}

        {phase === "ready" && result && (
          <section className="result-card" aria-labelledby="result-title">
            <div className="result-kicker">TRANSCRIPTION READY</div>
            <div className="result-heading">
              <div>
                <h2 id="result-title">{result.title}</h2>
                <p>{result.notes.length} notes · {formatDuration(result.duration)} · {result.merged} duplicate-looking retriggers joined</p>
              </div>
              <div className="result-actions">
                <button type="button" className="preview-button" onClick={playPreview}>
                  {isPlaying ? "Stop preview" : "Play preview"}
                </button>
                <a className="download-button" href={result.midiUrl} download={result.filename}>
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
          <h2 id="how-title">The shortest path from<br />performance to piano roll.</h2>
        </div>
        <div className="method-grid">
          <article><span>01</span><h3>Paste</h3><p>Drop in one public YouTube link. The app fetches only the audio it needs.</p></article>
          <article><span>02</span><h3>Listen</h3><p>A lightweight pitch model hears chords, melody, timing, and dynamics in your browser.</p></article>
          <article><span>03</span><h3>Edit</h3><p>Download a standard MIDI file for Logic, Ableton, FL Studio, GarageBand, or notation software.</p></article>
        </div>
      </section>

      <footer>
        <span>LINK TO MIDI</span>
        <p>Only convert media you have permission to use. Processing happens in your browser.</p>
      </footer>
    </main>
  );
}
