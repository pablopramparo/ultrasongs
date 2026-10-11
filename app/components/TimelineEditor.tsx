"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { EditorNote, NoteType } from "@/app/lib/editorNote";
import { detectPitch, hzToMidi } from "@/app/lib/pitchDetection";
import { useI18n } from "@/app/i18n/I18nProvider";
import RangeSlider from "./RangeSlider";

// ─── Layout constants ────────────────────────────────────────────────────────
const KEYS_W = 68;
const PX_PITCH = 18;
const MIN_PITCH = 36;    // C2
const MAX_PITCH = 96;    // C7
const ROLL_H = (MAX_PITCH - MIN_PITCH + 1) * PX_PITCH;
const RULER_H = 28;
/** Seconds between ruler labels; the first one that leaves enough room at the current zoom is used. */
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60];
/** Seconds between the faint lines drawn inside each labelled step. */
const RULER_MINOR: Record<number, number> = { 0.5: 0.1, 1: 0.25, 2: 0.5, 5: 1, 10: 2, 15: 5, 30: 5, 60: 10 };
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);

function noteName(p: number) { return `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`; }
function isBlack(p: number) { return BLACK.has(p % 12); }
function pitchToY(p: number) { return (MAX_PITCH - p) * PX_PITCH; }
/** Fill and label colour per note kind. Freestyle is hatched: it is drawn but never scored. */
function noteLook(type: NoteType): { background: string; border?: string; color?: string; fontStyle?: string } {
  switch (type) {
    case "*":
      return { background: "linear-gradient(90deg, #f59e0b, #f97316)" };
    case "F":
      return {
        background: "repeating-linear-gradient(135deg, rgba(100,116,139,0.55) 0 5px, rgba(71,85,105,0.55) 5px 10px)",
        border: "1px dashed #94a3b8",
        color: "#e2e8f0",
        fontStyle: "italic",
      };
    case "R":
      return { background: "linear-gradient(90deg, #14b8a6, #22d3ee)" };
    case "G":
      return { background: "linear-gradient(90deg, #f59e0b, #14b8a6)" };
    default:
      return { background: "linear-gradient(90deg, #3b82f6, #a855f7)" };
  }
}

function fmtClock(sec: number, decimals = false) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${decimals ? rest.toFixed(2).padStart(5, "0") : String(Math.floor(rest)).padStart(2, "0")}`;
}

interface Props {
  initialNotes: EditorNote[];
  bpm: number;
  gap: number;
  audioUrl: string;
  videoUrl?: string;
  title: string;
  artist: string;
  draftId?: string;
  onExport: (notes: EditorNote[], bpm: number, gap: number) => void;
  onClose?: () => void;
}

export default function TimelineEditor({
  initialNotes, bpm, gap, audioUrl, videoUrl, title, artist, draftId, onExport, onClose,
}: Props) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<EditorNote[]>(initialNotes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pxPerSec, setPxPerSec] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isNotePlaying, setIsNotePlaying] = useState(false);
  const [addMode, setAddMode] = useState(false);
  // Mixer: music is the audio element's volume; notes are synth tones (0 = off).
  const [musicVol, setMusicVol] = useState(1);
  const [noteVol, setNoteVol] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isMicTracePlaying, setIsMicTracePlaying] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micPlayEnabled, setMicPlayEnabled] = useState(false);
  const [micMidi, setMicMidi] = useState<number | null>(null);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState<string>("");
  const [micLabel, setMicLabel] = useState<string>("");
  const [micTrace, setMicTrace] = useState<Array<{ timeSec: number; midi: number }>>([]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  // Open with the notes in view: the pitch range is 4 octaves tall and the song may start late
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || didInitialScroll.current || initialNotes.length === 0) return;
    didInitialScroll.current = true;
    let lo = MAX_PITCH;
    let hi = MIN_PITCH;
    for (const n of initialNotes) {
      lo = Math.min(lo, n.pitch);
      hi = Math.max(hi, n.pitch);
    }
    el.scrollTop = Math.max(0, pitchToY((lo + hi) / 2) + RULER_H - el.clientHeight / 2);
    el.scrollLeft = Math.max(0, initialNotes[0].startSec * pxPerSec - 120);
  }, [initialNotes, pxPerSec]);
  const rafRef = useRef(0);
  const micRafRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const notePlayCtxRef = useRef<AudioContext | null>(null);
  const notePlayStartRef = useRef<number>(0);
  const notePlayOffsetRef = useRef<number>(0);
  const micTracePlayCtxRef = useRef<AudioContext | null>(null);
  const micTracePlayStartRef = useRef<number>(0);
  const micTracePlayOffsetRef = useRef<number>(0);
  const micPlayCtxRef = useRef<AudioContext | null>(null);
  const micPlayOscRef = useRef<OscillatorNode | null>(null);
  const micPlayGainRef = useRef<GainNode | null>(null);
  const micPlayEnabledRef = useRef(false);
  useEffect(() => { micPlayEnabledRef.current = micPlayEnabled; }, [micPlayEnabled]);
  const [micThreshold, setMicThreshold] = useState(0.02);
  const micThresholdRef = useRef(0.02);
  useEffect(() => { micThresholdRef.current = micThreshold; }, [micThreshold]);
  const [micOctaveShift, setMicOctaveShift] = useState(0);
  const micOctaveShiftRef = useRef(0);
  useEffect(() => { micOctaveShiftRef.current = micOctaveShift; }, [micOctaveShift]);
  const syllableInputRef = useRef<HTMLInputElement>(null);
  const pxPerSecRef = useRef(pxPerSec);
  useEffect(() => { pxPerSecRef.current = pxPerSec; }, [pxPerSec]);

  // Refs so mic tick can read playback state without stale closures
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  const isNotePlayingRef = useRef(false);
  useEffect(() => { isNotePlayingRef.current = isNotePlaying; }, [isNotePlaying]);
  const isMicTracePlayingRef = useRef(false);
  useEffect(() => { isMicTracePlayingRef.current = isMicTracePlaying; }, [isMicTracePlaying]);
  const playheadSecRef = useRef(0);
  useEffect(() => { playheadSecRef.current = playheadSec; }, [playheadSec]);

  // Pending mic points flushed to state every ~6 frames to avoid per-frame re-renders
  const micPendingRef = useRef<Array<{ timeSec: number; midi: number }>>([]);
  const micFrameRef = useRef(0);

  const duration = notes.reduce((m, n) => Math.max(m, n.startSec + n.durationSec), 10);
  const totalW = KEYS_W + (duration + 4) * pxPerSec;
  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  // ── Playback ──────────────────────────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    if (!draftId) return;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, bpm, gap }),
      });
      setSaveStatus(res.ok ? "saved" : "error");
    } catch {
      setSaveStatus("error");
    }
    setTimeout(() => setSaveStatus("idle"), 2000);
  }, [draftId, notes, bpm, gap]);

  const stopNotePlay = useCallback(() => {
    notePlayCtxRef.current?.close();
    notePlayCtxRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setIsNotePlaying(false);
  }, []);

  const stopMicTracePlay = useCallback(() => {
    micTracePlayCtxRef.current?.close();
    micTracePlayCtxRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setIsMicTracePlaying(false);
  }, []);

  const toggleMicTracePlay = useCallback(() => {
    if (isMicTracePlaying) { stopMicTracePlay(); return; }
    if (isPlaying) { audioRef.current?.pause(); videoRef.current?.pause(); cancelAnimationFrame(rafRef.current); setIsPlaying(false); }
    if (isNotePlaying) stopNotePlay();

    // Group trace points into continuous segments (gap > 200ms = new segment)
    const pts = [...micTrace].sort((a, b) => a.timeSec - b.timeSec);
    const segs: Array<{ start: number; end: number; midi: number }> = [];
    let segStart = -1, segEnd = -1, segPitches: number[] = [];
    for (const pt of pts) {
      if (segStart < 0 || pt.timeSec - segEnd > 0.2) {
        if (segStart >= 0) {
          const sp = [...segPitches].sort((a, b) => a - b);
          segs.push({ start: segStart, end: segEnd, midi: sp[Math.floor(sp.length / 2)] });
        }
        segStart = pt.timeSec; segEnd = pt.timeSec + 0.12; segPitches = [pt.midi];
      } else {
        segEnd = pt.timeSec + 0.12; segPitches.push(pt.midi);
      }
    }
    if (segStart >= 0) {
      const sp = [...segPitches].sort((a, b) => a - b);
      segs.push({ start: segStart, end: segEnd, midi: sp[Math.floor(sp.length / 2)] });
    }
    if (segs.length === 0) return;

    const ctx = new AudioContext();
    micTracePlayCtxRef.current = ctx;
    const offset = playheadSec;
    micTracePlayStartRef.current = ctx.currentTime;
    micTracePlayOffsetRef.current = offset;

    for (const seg of segs) {
      const startDelay = seg.start - offset;
      if (startDelay + (seg.end - seg.start) < 0) continue;
      const scheduleAt = ctx.currentTime + Math.max(0, startDelay);
      const dur = seg.end - seg.start;
      // Normalize octave to nearest note at this time
      const nearestNote = notes.reduce<EditorNote | null>((best, n) => {
        const mid = n.startSec + n.durationSec / 2;
        const segMid = (seg.start + seg.end) / 2;
        if (!best) return n;
        return Math.abs(mid - segMid) < Math.abs((best.startSec + best.durationSec / 2) - segMid) ? n : best;
      }, null);
      let midi = seg.midi;
      if (nearestNote) {
        const pitchClass = ((seg.midi % 12) + 12) % 12;
        const baseOctave = Math.floor(nearestNote.pitch / 12);
        const candidates = [
          (baseOctave - 1) * 12 + pitchClass,
          baseOctave * 12 + pitchClass,
          (baseOctave + 1) * 12 + pitchClass,
        ];
        midi = candidates.reduce((best, c) =>
          Math.abs(c - nearestNote.pitch) < Math.abs(best - nearestNote.pitch) ? c : best
        );
      }
      const hz = 440 * Math.pow(2, (midi - 69) / 12);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine"; osc.frequency.value = hz;
      const release = Math.min(0.08, dur * 0.15);
      gain.gain.setValueAtTime(0, scheduleAt);
      gain.gain.linearRampToValueAtTime(0.25, scheduleAt + 0.02);
      gain.gain.setValueAtTime(0.25, scheduleAt + dur - release);
      gain.gain.exponentialRampToValueAtTime(0.001, scheduleAt + dur);
      osc.start(scheduleAt); osc.stop(scheduleAt + dur + 0.05);
    }

    const endTime = segs[segs.length - 1].end;
    setIsMicTracePlaying(true);
    const tick = () => {
      const c = micTracePlayCtxRef.current;
      if (!c) return;
      const songTime = micTracePlayOffsetRef.current + (c.currentTime - micTracePlayStartRef.current);
      setPlayheadSec(songTime);
      if (songTime >= endTime + 0.5) { stopMicTracePlay(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [isMicTracePlaying, isPlaying, isNotePlaying, micTrace, notes, playheadSec, stopMicTracePlay, stopNotePlay]);

  const togglePlay = useCallback(() => {
    if (isNotePlaying) stopNotePlay();
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
      videoRef.current?.pause();
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    } else {
      if (videoRef.current) videoRef.current.currentTime = a.currentTime;
      a.play();
      videoRef.current?.play().catch(() => {});
      // Clear previous mic trace so each play session starts fresh
      setMicTrace([]);
      micPendingRef.current = [];
      setIsPlaying(true);
      const tick = () => {
        setPlayheadSec(audioRef.current?.currentTime ?? 0);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [isPlaying, isNotePlaying, stopNotePlay]);

  // ── Song + notes together ─────────────────────────────────────────────────
  // While the song plays with "Notas" on, schedule synth tones on a separate AudioContext,
  // aligned to the audio element's current time. Re-runs only on play/pause/checkbox, so
  // note edits made mid-playback take effect the next time playback starts.
  const mixNotesRef = useRef<EditorNote[]>(notes);
  useEffect(() => { mixNotesRef.current = notes; }, [notes]);
  const noteMasterRef = useRef<GainNode | null>(null);
  const noteVolRef = useRef(noteVol);
  useEffect(() => {
    noteVolRef.current = noteVol;
    if (noteMasterRef.current) noteMasterRef.current.gain.value = noteVol;
  }, [noteVol]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = musicVol;
  }, [musicVol]);

  const notesAudible = noteVol > 0;

  useEffect(() => {
    if (!isPlaying || !notesAudible) return;
    const a = audioRef.current;
    if (!a) return;

    const ctx = new AudioContext();
    const offset = a.currentTime;
    const master = ctx.createGain();
    master.gain.value = noteVolRef.current;
    master.connect(ctx.destination);
    noteMasterRef.current = master;

    for (const note of mixNotesRef.current) {
      const dur = note.durationSec;
      const startDelay = note.startSec - offset;
      if (startDelay + dur < 0) continue;
      // A note already under way when playback starts is clipped to its remaining part.
      const scheduleAt = ctx.currentTime + Math.max(0, startDelay);
      const remaining = startDelay < 0 ? dur + startDelay : dur;
      if (remaining <= 0.02) continue;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 440 * Math.pow(2, (note.pitch - 69) / 12);
      osc.connect(gain);
      gain.connect(master);
      const release = Math.min(0.08, remaining * 0.15);
      gain.gain.setValueAtTime(0, scheduleAt);
      gain.gain.linearRampToValueAtTime(0.25, scheduleAt + 0.02);
      gain.gain.setValueAtTime(0.25, scheduleAt + remaining - release);
      gain.gain.exponentialRampToValueAtTime(0.001, scheduleAt + remaining);
      osc.start(scheduleAt);
      osc.stop(scheduleAt + remaining + 0.05);
    }

    return () => {
      noteMasterRef.current = null;
      ctx.close().catch(() => {});
    };
  }, [isPlaying, notesAudible]);

  const toggleNotePlay = useCallback(() => {
    if (isNotePlaying) { stopNotePlay(); return; }
    if (isPlaying) {
      audioRef.current?.pause();
      videoRef.current?.pause();
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    }
    const ctx = new AudioContext();
    notePlayCtxRef.current = ctx;
    const offset = playheadSec;
    notePlayStartRef.current = ctx.currentTime;
    notePlayOffsetRef.current = offset;

    for (const note of notes) {
      const startDelay = note.startSec - offset;
      if (startDelay + note.durationSec < 0) continue;
      const scheduleAt = ctx.currentTime + Math.max(0, startDelay);
      const hz = 440 * Math.pow(2, (note.pitch - 69) / 12);
      const dur = note.durationSec;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = hz;
      const release = Math.min(0.08, dur * 0.15);
      gain.gain.setValueAtTime(0, scheduleAt);
      gain.gain.linearRampToValueAtTime(0.25, scheduleAt + 0.02);
      gain.gain.setValueAtTime(0.25, scheduleAt + dur - release);
      gain.gain.exponentialRampToValueAtTime(0.001, scheduleAt + dur);
      osc.start(scheduleAt);
      osc.stop(scheduleAt + dur + 0.05);
    }

    setMicTrace([]);
    micPendingRef.current = [];
    setIsNotePlaying(true);
    const tick = () => {
      const c = notePlayCtxRef.current;
      if (!c) return;
      const songTime = notePlayOffsetRef.current + (c.currentTime - notePlayStartRef.current);
      setPlayheadSec(songTime);
      if (songTime >= duration + 1) { stopNotePlay(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [isNotePlaying, isPlaying, playheadSec, notes, duration, stopNotePlay]);

  const seekTo = useCallback((sec: number) => {
    const clamped = Math.max(0, sec);
    setPlayheadSec(clamped);
    if (audioRef.current) audioRef.current.currentTime = clamped;
    if (videoRef.current) videoRef.current.currentTime = clamped;
  }, []);

  const playNotePreview = useCallback((midi: number, durationSec: number) => {
    if (!previewCtxRef.current || previewCtxRef.current.state === "closed") {
      previewCtxRef.current = new AudioContext();
    }
    const ctx = previewCtxRef.current;
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    const dur = Math.min(Math.max(durationSec, 0.15), 1.5);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = hz;
    const release = Math.min(0.08, dur * 0.15);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.02);
    gain.gain.setValueAtTime(0.35, now + dur - release);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.start(now);
    osc.stop(now + dur);
  }, []);

  // Auto-scroll playhead into view
  useEffect(() => {
    if ((!isPlaying && !isNotePlaying) || !scrollRef.current) return;
    const x = playheadSec * pxPerSec;
    const container = scrollRef.current;
    const visible = container.scrollLeft + container.clientWidth - KEYS_W;
    if (x > visible - 40 || x < container.scrollLeft) {
      container.scrollLeft = Math.max(0, x - 80);
    }
  }, [isPlaying, isNotePlaying, playheadSec, pxPerSec]);

  // ── Microphone ────────────────────────────────────────────────────────────
  const startMic = useCallback(async (deviceId?: string) => {
    cancelAnimationFrame(micRafRef.current);
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    micStreamRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current = null;

    const constraints: MediaStreamConstraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    micStreamRef.current = stream;

    const track = stream.getAudioTracks()[0];
    setMicLabel(track.label || "Micrófono");

    // Enumerate after getUserMedia so labels are populated (browser policy)
    const all = await navigator.mediaDevices.enumerateDevices();
    setMicDevices(all.filter((d) => d.kind === "audioinput"));

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;
    ctx.createMediaStreamSource(stream).connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    micFrameRef.current = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      // RMS amplitude gate — reject silence/ambient noise below threshold
      let rms = 0;
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      const hz = rms >= micThresholdRef.current ? detectPitch(buf, ctx.sampleRate) : -1;
      const rawMidi = hz > 0 ? hzToMidi(hz) : null;
      const shifted = rawMidi !== null ? rawMidi + micOctaveShiftRef.current * 12 : null;
      const valid = shifted !== null && shifted >= MIN_PITCH && shifted <= MAX_PITCH ? shifted : null;
      setMicMidi(valid);

      // Drive real-time tone from mic
      if (micPlayEnabledRef.current && micPlayCtxRef.current && micPlayOscRef.current && micPlayGainRef.current) {
        const mctx = micPlayCtxRef.current;
        if (valid !== null) {
          const hz = 440 * Math.pow(2, (valid - 69) / 12);
          micPlayOscRef.current.frequency.setTargetAtTime(hz, mctx.currentTime, 0.04);
          micPlayGainRef.current.gain.setTargetAtTime(0.2, mctx.currentTime, 0.1);
        } else {
          micPlayGainRef.current.gain.setTargetAtTime(0, mctx.currentTime, 0.1);
        }
      }

      // Record pitch when any playback is active (~10 points/sec, every 6 frames at 60fps)
      const anyPlaying = isPlayingRef.current || isNotePlayingRef.current || isMicTracePlayingRef.current;
      if (anyPlaying && valid !== null) {
        micPendingRef.current.push({ timeSec: playheadSecRef.current, midi: valid });
      }
      micFrameRef.current++;
      if (micFrameRef.current % 6 === 0 && micPendingRef.current.length > 0) {
        const batch = micPendingRef.current.splice(0);
        setMicTrace((prev) => [...prev, ...batch]);
      }

      micRafRef.current = requestAnimationFrame(tick);
    };
    micRafRef.current = requestAnimationFrame(tick);
  }, []);

  const toggleMic = useCallback(async () => {
    if (micEnabled) {
      cancelAnimationFrame(micRafRef.current);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      micStreamRef.current = null;
      analyserRef.current = null;
      audioCtxRef.current = null;
      micPlayCtxRef.current?.close();
      micPlayCtxRef.current = null;
      micPlayOscRef.current = null;
      micPlayGainRef.current = null;
      setMicPlayEnabled(false);
      setMicMidi(null);
      setMicLabel("");
      setMicEnabled(false);
      return;
    }
    try {
      await startMic(micDeviceId || undefined);
      setMicEnabled(true);
    } catch {
      setMicEnabled(false);
    }
  }, [micEnabled, micDeviceId, startMic]);

  // ── Mic monitor tone ─────────────────────────────────────────────────────
  const toggleMicPlay = useCallback(() => {
    if (micPlayEnabled) {
      if (micPlayGainRef.current && micPlayCtxRef.current) {
        micPlayGainRef.current.gain.setTargetAtTime(0, micPlayCtxRef.current.currentTime, 0.05);
      }
      setTimeout(() => {
        micPlayCtxRef.current?.close();
        micPlayCtxRef.current = null;
        micPlayOscRef.current = null;
        micPlayGainRef.current = null;
      }, 300);
      setMicPlayEnabled(false);
    } else {
      const ctx = new AudioContext();
      micPlayCtxRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      gain.gain.setValueAtTime(0, ctx.currentTime);
      osc.start();
      micPlayOscRef.current = osc;
      micPlayGainRef.current = gain;
      setMicPlayEnabled(true);
    }
  }, [micPlayEnabled]);

  // ── Apply mic trace to note pitches ──────────────────────────────────────
  const applyMicTrace = useCallback(() => {
    if (micTrace.length === 0) return;
    setNotes((prev) =>
      prev.map((note) => {
        const pts = micTrace.filter(
          (p) => p.timeSec >= note.startSec && p.timeSec <= note.startSec + note.durationSec
        );
        if (pts.length === 0) return note;
        const rawMidis = pts.map((p) => p.midi).sort((a, b) => a - b);
        const rawMedian = rawMidis[Math.floor(rawMidis.length / 2)];
        // Normalize to the octave closest to the note's current pitch
        // so male/female voices (an octave apart) both map correctly
        const pitchClass = ((rawMedian % 12) + 12) % 12;
        const baseOctave = Math.floor(note.pitch / 12);
        const candidates = [
          (baseOctave - 1) * 12 + pitchClass,
          baseOctave * 12 + pitchClass,
          (baseOctave + 1) * 12 + pitchClass,
        ];
        const normalized = candidates.reduce((best, c) =>
          Math.abs(c - note.pitch) < Math.abs(best - note.pitch) ? c : best
        );
        return { ...note, pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, normalized)) };
      })
    );
  }, [micTrace]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(micRafRef.current);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      previewCtxRef.current?.close();
      notePlayCtxRef.current?.close();
      micTracePlayCtxRef.current?.close();
      micPlayCtxRef.current?.close();
    };
  }, []);

  // ── Drag note (move / resize) ─────────────────────────────────────────────
  const startDrag = useCallback(
    (e: React.MouseEvent, note: EditorNote, kind: "move" | "resize") => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedId(note.id);
      const startX = e.clientX;
      const startY = e.clientY;
      const { startSec, durationSec, pitch } = note;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const pps = pxPerSecRef.current;
        setNotes((prev) =>
          prev.map((n) => {
            if (n.id !== note.id) return n;
            if (kind === "resize") return { ...n, durationSec: Math.max(0.05, durationSec + dx / pps) };
            return {
              ...n,
              startSec: Math.max(0, startSec + dx / pps),
              pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch - Math.round(dy / PX_PITCH))),
            };
          })
        );
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    []
  );

  // ── Drag playhead ─────────────────────────────────────────────────────────
  const startPlayheadDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isPlaying) {
        audioRef.current?.pause();
        videoRef.current?.pause();
        cancelAnimationFrame(rafRef.current);
        setIsPlaying(false);
      }
      const container = scrollRef.current;
      const onMove = (ev: MouseEvent) => {
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const x = ev.clientX - rect.left + container.scrollLeft - KEYS_W;
        seekTo(Math.max(0, x / pxPerSecRef.current));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [isPlaying, seekTo]
  );

  // ── Seek on grid single-click ─────────────────────────────────────────────
  const addModeRef = useRef(false);
  useEffect(() => { addModeRef.current = addMode; }, [addMode]);

  const handleGridClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (addModeRef.current) {
        const sec = Math.max(0, (e.clientX - rect.left) / pxPerSecRef.current);
        const yRel = e.clientY - rect.top;
        const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.round(MAX_PITCH - yRel / PX_PITCH)));
        const id = crypto.randomUUID();
        const newNote: EditorNote = { id, startSec: sec, durationSec: 0.3, pitch, syllable: "+", type: ":" };
        setNotes((prev) => [...prev, newNote].sort((a, b) => a.startSec - b.startSec));
        setSelectedId(id);
        setTimeout(() => { syllableInputRef.current?.focus(); syllableInputRef.current?.select(); }, 0);
      } else {
        const sec = (e.clientX - rect.left) / pxPerSecRef.current;
        seekTo(sec);
      }
    },
    [seekTo]
  );

  // ── Split selected note ───────────────────────────────────────────────────
  const splitSelected = useCallback(() => {
    if (!selectedId) return;
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === selectedId);
      if (idx === -1) return prev;
      const n = prev[idx];
      const half = n.durationSec / 2;
      const cut = Math.ceil(n.syllable.length / 2);
      const a: EditorNote = { ...n, durationSec: half, syllable: n.syllable.slice(0, cut) };
      const b: EditorNote = {
        ...n, id: crypto.randomUUID(), startSec: n.startSec + half,
        durationSec: half, syllable: n.syllable.slice(cut),
      };
      const result = [...prev];
      result.splice(idx, 1, a, b);
      return result;
    });
  }, [selectedId]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return; // don't steal input events
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if ((e.code === "Delete" || e.code === "Backspace") && selectedId) {
        setNotes((prev) => prev.filter((n) => n.id !== selectedId));
        setSelectedId(null);
      }
      if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey && selectedId) {
        e.preventDefault();
        splitSelected();
      }
      // G: golden on/off (rap notes keep their rap kind); F: freestyle on/off
      if ((e.code === "KeyG" || e.code === "KeyF") && !e.ctrlKey && !e.metaKey && selectedId) {
        e.preventDefault();
        const golden: Record<NoteType, NoteType> = { ":": "*", "*": ":", F: "*", R: "G", G: "R" };
        setNotes((prev) =>
          prev.map((n) => {
            if (n.id !== selectedId) return n;
            if (e.code === "KeyG") return { ...n, type: golden[n.type] };
            return { ...n, type: n.type === "F" ? ":" : "F" };
          })
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, selectedId, splitSelected]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const playheadX = KEYS_W + playheadSec * pxPerSec;
  const micY = micMidi !== null ? pitchToY(micMidi) + PX_PITCH / 2 : null;

  // ── Time ruler ────────────────────────────────────────────────────────────
  // Label spacing adapts to the zoom: the first step that leaves at least ~84 px between labels.
  const labelStep = RULER_STEPS.find((s) => s * pxPerSec >= 84) ?? 60;
  const minorStep = RULER_MINOR[labelStep] ?? labelStep / 4;
  const rulerTicks: number[] = [];
  for (let tm = 0; tm <= duration + 4; tm += labelStep) rulerTicks.push(Math.round(tm * 100) / 100);
  const gridBackground = [
    `repeating-linear-gradient(to right, rgba(148,163,184,0.18) 0, rgba(148,163,184,0.18) 1px, transparent 1px, transparent ${labelStep * pxPerSec}px)`,
    `repeating-linear-gradient(to right, rgba(148,163,184,0.07) 0, rgba(148,163,184,0.07) 1px, transparent 1px, transparent ${minorStep * pxPerSec}px)`,
  ].join(",");

  const chip =
    "rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700";
  const squareBtn =
    "flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors";

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-zinc-950">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-2.5">
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold text-zinc-50">{title}</span>
          <span className="block truncate text-xs text-zinc-400">{artist}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <span>{t("editor.zoom")}</span>
            <RangeSlider
              value={pxPerSec} max={400} step={10}
              onChange={(v) => setPxPerSec(Math.max(40, v))}
              label={t("editor.zoom")} className="w-24"
            />
          </label>

          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleMic}
              title={micLabel || undefined}
              className={`${chip} ${micEnabled ? "!border-green-700 !bg-green-950 !text-green-300" : ""}`}
            >
              🎤 {micEnabled ? (micLabel ? micLabel.split("(")[0].trim() : t("editor.micOn")) : t("editor.mic")}
            </button>
            {micEnabled && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-400" title={t("editor.micSensitivityTitle")}>
                <span>{t("editor.micSensitivity")}</span>
                <RangeSlider
                  value={micThreshold} max={0.08} step={0.005}
                  onChange={(v) => setMicThreshold(Math.max(0.005, v))}
                  label={t("editor.micSensitivity")} color="#22c55e" className="w-16"
                />
              </label>
            )}
            {micEnabled && (
              <div className="flex items-center gap-1 text-xs">
                <button onClick={() => setMicOctaveShift((s) => Math.max(-2, s - 1))} className={chip}>
                  {t("editor.octaveDown")}
                </button>
                <span className="w-6 text-center text-zinc-400">
                  {micOctaveShift > 0 ? `+${micOctaveShift}` : micOctaveShift}
                </span>
                <button onClick={() => setMicOctaveShift((s) => Math.min(2, s + 1))} className={chip}>
                  {t("editor.octaveUp")}
                </button>
              </div>
            )}
            {micEnabled && (
              <button
                onClick={toggleMicPlay}
                title={t("editor.micListenTitle")}
                className={`${chip} ${micPlayEnabled ? "!border-amber-700 !bg-amber-950 !text-amber-300" : ""}`}
              >
                🔊
              </button>
            )}
            {micDevices.length > 1 && (
              <select
                value={micDeviceId}
                onChange={async (e) => {
                  const id = e.target.value;
                  setMicDeviceId(id);
                  if (micEnabled) {
                    try { await startMic(id); } catch { /* ignore */ }
                  }
                }}
                className="max-w-40 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-200"
              >
                {micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || t("editor.micDevice", { id: d.deviceId.slice(0, 6) })}
                  </option>
                ))}
              </select>
            )}
          </div>

          {draftId && (
            <button
              onClick={saveDraft}
              disabled={saveStatus === "saving"}
              className={`btn !px-3 !py-1.5 text-xs ${
                saveStatus === "saved"
                  ? "bg-green-600 text-white"
                  : saveStatus === "error"
                  ? "bg-red-600 text-white"
                  : "btn-secondary"
              }`}
            >
              {saveStatus === "saving" ? t("editor.saving") : saveStatus === "saved" ? t("editor.saved") : saveStatus === "error" ? t("editor.error") : t("editor.save")}
            </button>
          )}
          <button onClick={() => onExport(notes, bpm, gap)} className="btn btn-primary !px-3 !py-1.5 text-xs">
            {t("editor.export")}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label={t("action.close")}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Transport ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            onClick={togglePlay}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-500"
            title="Space"
          >
            {isPlaying ? (
              <svg viewBox="0 0 10 10" className="h-3.5 w-3.5" fill="currentColor">
                <rect x="1" y="1" width="3" height="8" rx="0.5" /><rect x="6" y="1" width="3" height="8" rx="0.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 10 10" className="h-3.5 w-3.5" fill="currentColor">
                <polygon points="2.2,1 9,5 2.2,9" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setAddMode((v) => !v)}
            title={t("editor.addNoteTitle")}
            className={`${squareBtn} text-base font-bold ${
              addMode ? "bg-emerald-500 text-white hover:bg-emerald-400" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            +
          </button>
          <button
            onClick={toggleNotePlay}
            title={t("editor.notesOnlyTitle")}
            className={`${squareBtn} ${
              isNotePlaying ? "bg-amber-500 text-white hover:bg-amber-400" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            ♪
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <span className="font-mono text-sm tabular-nums text-zinc-100">
            {fmtClock(playheadSec, true)} <span className="text-zinc-500">/ {fmtClock(duration)}</span>
          </span>
          <RangeSlider
            value={Math.min(playheadSec, duration)} max={duration} step={0.01}
            onChange={seekTo} label={t("player.seek")} className="w-44"
          />
        </div>

        <div className="flex items-center gap-4">
          <label title={t("editor.musicTitle")} className="flex select-none items-center gap-2 text-zinc-300">
            {t("editor.music")}
            <RangeSlider value={musicVol} max={1} step={0.05} onChange={setMusicVol} label={t("editor.music")} className="w-20" />
          </label>
          <label title={t("editor.notesTitle")} className="flex select-none items-center gap-2 text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {t("editor.notes")}
            <RangeSlider value={noteVol} max={1} step={0.05} onChange={setNoteVol} label={t("editor.notes")} color="#f59e0b" className="w-20" />
          </label>
        </div>

        {/* Selected note */}
        {selectedNote && (
          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1">
            <input
              ref={syllableInputRef}
              value={selectedNote.syllable}
              onChange={(e) =>
                setNotes((prev) =>
                  prev.map((n) => n.id === selectedId ? { ...n, syllable: e.target.value } : n)
                )
              }
              placeholder={t("editor.syllable")}
              className="w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
            />
            <button onClick={splitSelected} title={t("editor.splitTitle")} className={chip}>
              {t("editor.split")}
            </button>
            <select
              value={selectedNote.type}
              onChange={(e) =>
                setNotes((prev) =>
                  prev.map((n) => n.id === selectedId ? { ...n, type: e.target.value as NoteType } : n)
                )
              }
              className="rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-200"
            >
              <option value=":">{t("editor.noteNormal")}</option>
              <option value="*">★ {t("editor.noteGolden")}</option>
              <option value="F">{t("editor.noteFreestyle")}</option>
              <option value="R">{t("editor.noteRap")}</option>
              <option value="G">★ {t("editor.noteRapGolden")}</option>
            </select>
            <button
              onClick={() => { setNotes((prev) => prev.filter((n) => n.id !== selectedId)); setSelectedId(null); }}
              title={t("editor.deleteTitle")}
              className="rounded-md border border-red-900 px-2 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-950"
            >
              {t("editor.delete")}
            </button>
          </div>
        )}

        {micEnabled && (
          <span className="text-green-400">
            🎤 {micMidi !== null ? noteName(micMidi) : "—"}
            {isPlaying && <span className="ml-1 animate-pulse text-green-500">●</span>}
          </span>
        )}
        {micTrace.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400">{t("editor.points", { n: micTrace.length })}</span>
            <button
              onClick={toggleMicTracePlay}
              className={`${chip} ${isMicTracePlaying ? "!border-amber-600 !bg-amber-500 !text-white" : ""}`}
            >
              {isMicTracePlaying ? "■ Mic" : "♪ Mic"}
            </button>
            <button onClick={applyMicTrace} className="btn btn-primary !bg-green-600 hover:!bg-green-500 !px-2 !py-1 text-xs">
              {t("editor.applyMic")}
            </button>
            <button onClick={() => { setMicTrace([]); micPendingRef.current = []; }} className={chip}>
              {t("editor.clear")}
            </button>
          </div>
        )}

        <span className="ml-auto hidden text-zinc-500 xl:block">{t("editor.help")}</span>
      </div>

      {/* ── Piano roll ── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-zinc-950">
        {/* Time ruler: sticks to the top while the roll scrolls vertically */}
        <div
          className="sticky top-0 z-30 cursor-pointer select-none border-b border-zinc-800 bg-zinc-900"
          style={{ width: totalW, height: RULER_H }}
          onMouseDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo(Math.max(0, (e.clientX - rect.left - KEYS_W) / pxPerSecRef.current));
          }}
        >
          <div
            className="sticky left-0 z-10 border-r border-zinc-800 bg-zinc-900"
            style={{ position: "sticky", left: 0, width: KEYS_W, height: "100%" }}
          />
          {rulerTicks.map((tm) => (
            <div key={tm} style={{ position: "absolute", left: KEYS_W + tm * pxPerSec, top: 0, height: "100%", pointerEvents: "none" }}>
              <div style={{ position: "absolute", left: 0, bottom: 0, width: 1, height: 10, background: "#475569" }} />
              <span style={{ position: "absolute", left: 5, top: 4 }} className="font-mono text-[11px] text-zinc-400">
                {fmtClock(tm, labelStep < 1)}
              </span>
            </div>
          ))}
          {/* Playhead marker */}
          <div
            style={{
              position: "absolute", left: playheadX - 5, top: RULER_H - 9, width: 0, height: 0,
              borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "8px solid #ef4444",
              pointerEvents: "none",
            }}
          />
        </div>

        <div style={{ width: totalW, height: ROLL_H, position: "relative" }}>

          {/* Piano keys */}
          <div style={{ position: "sticky", left: 0, top: 0, width: KEYS_W, height: ROLL_H, zIndex: 20, flexShrink: 0 }}>
            {Array.from({ length: MAX_PITCH - MIN_PITCH + 1 }, (_, i) => {
              const p = MAX_PITCH - i;
              const black = isBlack(p);
              const highlighted = micMidi === p;
              const isC = p % 12 === 0;
              return (
                <div
                  key={p}
                  style={{ position: "absolute", top: i * PX_PITCH, left: 0, width: KEYS_W - 1, height: PX_PITCH }}
                  className={`flex items-center border-b border-r text-[10px] select-none transition-colors ${
                    highlighted
                      ? "border-green-500 bg-green-400 text-white"
                      : black
                      ? "border-zinc-800 bg-zinc-950 text-zinc-600"
                      : isC
                      ? "border-zinc-600 bg-zinc-700 font-semibold text-zinc-100"
                      : "border-zinc-800 bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {!black && <span className="ml-2">{isC ? noteName(p) : NOTE_NAMES[p % 12]}</span>}
                </div>
              );
            })}
          </div>

          {/* Grid rows + time lines */}
          <div
            style={{ position: "absolute", left: KEYS_W, top: 0, right: 0, height: ROLL_H, zIndex: 1, cursor: addMode ? "crosshair" : "default" }}
            onClick={handleGridClick}
          >
            {Array.from({ length: MAX_PITCH - MIN_PITCH + 1 }, (_, i) => {
              const p = MAX_PITCH - i;
              return (
                <div
                  key={p}
                  style={{ position: "absolute", top: i * PX_PITCH, left: 0, right: 0, height: PX_PITCH }}
                  className={`${isBlack(p) ? "bg-zinc-950" : "bg-zinc-900"} ${p % 12 === 0 ? "border-b border-zinc-700" : ""}`}
                />
              );
            })}
            <div style={{ position: "absolute", inset: 0, backgroundImage: gridBackground, zIndex: 2, pointerEvents: "none" }} />
          </div>

          {/* Mic trace dots */}
          {micTrace.map((pt, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: KEYS_W + pt.timeSec * pxPerSec - 2,
                top: pitchToY(pt.midi) + PX_PITCH / 2 - 2,
                width: 4, height: 4,
                borderRadius: "50%",
                background: "rgba(34,197,94,0.65)",
                zIndex: 15,
                pointerEvents: "none",
              }}
            />
          ))}

          {/* Notes */}
          {notes.map((note) => {
            const x = KEYS_W + note.startSec * pxPerSec;
            const y = pitchToY(note.pitch);
            const w = note.durationSec * pxPerSec;
            const sel = note.id === selectedId;
            return (
              <div
                key={note.id}
                style={{
                  position: "absolute", left: x + 1, top: y + 2,
                  width: Math.max(w - 2, 8), height: PX_PITCH - 4,
                  zIndex: sel ? 30 : 10, cursor: "grab", userSelect: "none",
                  ...noteLook(note.type),
                  boxShadow: sel ? "0 0 0 2px #fff, 0 4px 12px rgba(0,0,0,0.5)" : "0 1px 3px rgba(0,0,0,0.45)",
                }}
                className="flex items-center overflow-hidden whitespace-nowrap rounded-md px-1.5 text-[11px] font-semibold text-white transition-[filter] hover:brightness-110"
                onMouseDown={(e) => startDrag(e, note, "move")}
                onClick={(e) => { e.stopPropagation(); playNotePreview(note.pitch, note.durationSec); }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                {(note.type === "*" || note.type === "G") && <span className="mr-0.5">★</span>}
                {note.syllable}
                {/* Resize handle */}
                <div
                  style={{ position: "absolute", right: 0, top: 0, width: 6, height: "100%", cursor: "ew-resize" }}
                  onMouseDown={(e) => startDrag(e, note, "resize")}
                />
              </div>
            );
          })}

          {/* Playhead — draggable */}
          <div
            style={{
              position: "absolute", left: playheadX - 4, top: 0,
              width: 10, height: ROLL_H,
              zIndex: 40, cursor: "col-resize",
            }}
            onMouseDown={startPlayheadDrag}
          >
            {/* Visual line centred in the hit area */}
            <div style={{ position: "absolute", left: 4, top: 0, width: 2, height: "100%", background: "#ef4444" }} />
          </div>

          {/* Mic guide line */}
          {micEnabled && micY !== null && (
            <div style={{
              position: "absolute", left: KEYS_W, top: micY - 1, right: 0,
              height: 2, background: "rgba(34,197,94,0.75)", zIndex: 35, pointerEvents: "none",
            }} />
          )}
        </div>
      </div>

      {/* Video thumbnail, floating over the roll so it takes no layout space */}
      {videoUrl && (
        <div className="pointer-events-none absolute bottom-4 right-6 z-50 w-60 overflow-hidden rounded-lg border border-zinc-700 bg-black shadow-2xl shadow-black/60">
          <video ref={videoRef} src={videoUrl} muted className="aspect-video w-full object-contain" />
        </div>
      )}

      <audio
        ref={audioRef}
        src={audioUrl}
        onEnded={() => {
          videoRef.current?.pause();
          setIsPlaying(false);
          cancelAnimationFrame(rafRef.current);
        }}
      />
    </div>
  );
}
