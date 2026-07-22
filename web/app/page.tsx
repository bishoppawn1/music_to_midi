"use client";

import { FormEvent, useRef, useState } from "react";

type Phase =
  | "idle"
  | "fetching"
  | "decoding"
  | "listening"
  | "cleaning"
  | "ready"
  | "error";

type CleanNote = {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
};

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

function rms(samples: Float32Array, start: number, end: number) {
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(samples.length, Math.ceil(end));
  if (to <= from) return 0;
  let sum = 0;
  for (let index = from; index < to; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / (to - from));
}

function hasFreshAttack(samples: Float32Array, time: number) {
  const center = time * SAMPLE_RATE;
  const before = rms(samples, center - SAMPLE_RATE * 0.055, center - SAMPLE_RATE * 0.01);
  const after = rms(samples, center, center + SAMPLE_RATE * 0.045);
  return after > 0.012 && after > before * 1.22;
}

function cleanRetriggers(notes: CleanNote[], samples: Float32Array) {
  const ordered = [...notes].sort(
    (left, right) =>
      left.startTimeSeconds - right.startTimeSeconds || left.pitchMidi - right.pitchMidi,
  );
  const cleaned: CleanNote[] = [];
  const latestByPitch = new Map<number, CleanNote>();
  let merged = 0;

  for (const sourceNote of ordered) {
    const note = { ...sourceNote };
    const previous = latestByPitch.get(note.pitchMidi);
    if (previous) {
      const previousEnd = previous.startTimeSeconds + previous.durationSeconds;
      const gap = note.startTimeSeconds - previousEnd;
      if (gap >= -0.015 && gap <= 0.025 && !hasFreshAttack(samples, note.startTimeSeconds)) {
        previous.durationSeconds =
          Math.max(previousEnd, note.startTimeSeconds + note.durationSeconds) -
          previous.startTimeSeconds;
        previous.amplitude = Math.max(previous.amplitude, note.amplitude);
        merged += 1;
        continue;
      }
    }
    cleaned.push(note);
    latestByPitch.set(note.pitchMidi, note);
  }

  return { notes: cleaned, merged };
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
      const rawNotes = basicPitchModule.noteFramesToTime(
        basicPitchModule.addPitchBendsToNoteEvents(
          contours,
          basicPitchModule.outputToNotesPoly(frames, onsets, 0.62, 0.25, 11),
        ),
      ).map((note) => ({
        startTimeSeconds: note.startTimeSeconds,
        durationSeconds: note.durationSeconds,
        pitchMidi: note.pitchMidi,
        amplitude: note.amplitude,
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
