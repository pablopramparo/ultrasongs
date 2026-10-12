"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { hasLineMarks, inferLineStarts, type EditorNote, type NoteType } from "@/app/lib/editorNote";
import { detectPitch, hzToMidi } from "@/app/lib/pitchDetection";
import { useI18n } from "@/app/i18n/I18nProvider";
import RangeSlider from "./RangeSlider";
import EditorHelp from "./EditorHelp";

// ─── Layout constants ────────────────────────────────────────────────────────
const KEYS_W = 68;
/** Row height (vertical zoom) bounds, in px per semitone. */
const PX_PITCH_DEFAULT = 18;
const PX_PITCH_MIN = 10;
const PX_PITCH_MAX = 40;
/** Horizontal zoom bounds, in px per second. */
const PX_SEC_DEFAULT = 120;
const PX_SEC_MIN = 40;
const PX_SEC_MAX = 400;
/** Pointer travel (px) before a press on the grid becomes a rubber-band selection. */
const DRAG_THRESHOLD = 4;
const HISTORY_LIMIT = 100;
/** Default video thumbnail offsets: clear of the roll's horizontal scrollbar and the bottom bar. */
const VIDEO_DEFAULT_POS = { right: 24, bottom: 76 };
/** Hard limits of the pitch axis (MIDI). */
const PITCH_MIN = 0;
const PITCH_MAX = 127;
/** Voice range the microphone detector is expected to report. */
const MIC_MIN_PITCH = 36;
const MIC_MAX_PITCH = 96;
/** The roll shows the notes' range plus about one octave on each side, and never less than this. */
const RANGE_MARGIN = 12;
const RANGE_MIN_ROWS = 36;
const RULER_H = 28;
/** Seconds between ruler labels; the first one that leaves enough room at the current zoom is used. */
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60];
/** Seconds between the faint lines drawn inside each labelled step. */
const RULER_MINOR: Record<number, number> = { 0.5: 0.1, 1: 0.25, 2: 0.5, 5: 1, 10: 2, 15: 5, 30: 5, 60: 10 };
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);

function noteName(p: number) { return `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`; }
function isBlack(p: number) { return BLACK.has(p % 12); }
/** Visible pitch range for a set of notes: their extremes plus a margin, at least RANGE_MIN_ROWS tall. */
function fitRange(notes: EditorNote[]): { lo: number; hi: number } {
  if (notes.length === 0) return { lo: 48, hi: 83 };
  let min = PITCH_MAX;
  let max = PITCH_MIN;
  for (const n of notes) {
    min = Math.min(min, n.pitch);
    max = Math.max(max, n.pitch);
  }
  let lo = Math.max(PITCH_MIN, min - RANGE_MARGIN);
  let hi = Math.min(PITCH_MAX, max + RANGE_MARGIN);
  const missing = RANGE_MIN_ROWS - (hi - lo + 1);
  if (missing > 0) {
    lo = Math.max(PITCH_MIN, lo - Math.floor(missing / 2));
    hi = Math.min(PITCH_MAX, hi + Math.ceil(missing / 2));
  }
  return { lo, hi };
}
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

/** Removes a note; if it opened a phrase, the next note takes over that role. */
function withoutNote(list: EditorNote[], id: string): EditorNote[] {
  const idx = list.findIndex((n) => n.id === id);
  if (idx === -1) return list;
  const removed = list[idx];
  const rest = list.filter((n) => n.id !== id);
  if (removed.lineStart && rest[idx] && !rest[idx].lineStart) rest[idx] = { ...rest[idx], lineStart: true };
  return rest;
}

/**
 * Plays notes as synth tones against a song clock, scheduling only the next fraction of a second.
 * Unlike scheduling the whole song up front, it follows seeks (call `reset`) and edits made while
 * playing, so what is heard is always what the roll shows at the playhead.
 */
function createToneScheduler(
  ctx: AudioContext,
  dest: AudioNode,
  getSongTime: () => number,
  getNotes: () => EditorNote[]
) {
  const LOOKAHEAD = 0.3;
  const scheduled = new Set<string>();
  let active: OscillatorNode[] = [];
  let lastT = getSongTime();

  const reset = () => {
    for (const osc of active) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    active = [];
    scheduled.clear();
  };

  const tick = () => {
    const t = getSongTime();
    if (Math.abs(t - lastT) > 0.5) reset(); // the clock jumped: a seek
    lastT = t;
    for (const n of getNotes()) {
      if (scheduled.has(n.id)) continue;
      if (n.startSec + n.durationSec <= t || n.startSec > t + LOOKAHEAD) continue;
      scheduled.add(n.id);
      const delay = n.startSec - t;
      // A note already under way is clipped to its remaining part.
      const remaining = delay < 0 ? n.durationSec + delay : n.durationSec;
      if (remaining <= 0.02) continue;
      const at = ctx.currentTime + Math.max(0, delay);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 440 * Math.pow(2, (n.pitch - 69) / 12);
      osc.connect(gain);
      gain.connect(dest);
      const release = Math.min(0.08, remaining * 0.15);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.25, at + 0.02);
      gain.gain.setValueAtTime(0.25, at + remaining - release);
      gain.gain.exponentialRampToValueAtTime(0.001, at + remaining);
      osc.start(at);
      osc.stop(at + remaining + 0.05);
      osc.onended = () => { active = active.filter((o) => o !== osc); };
      active.push(osc);
    }
  };

  const timer = setInterval(tick, 40);
  tick();
  return {
    reset,
    stop: () => { clearInterval(timer); reset(); },
  };
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
  /** Progress and result of the last export, shown inside the editor (the page behind it is hidden). */
  exportStatus?: {
    busy: boolean;
    url: string | null;
    filename: string;
    savedTo?: string | null;
    saveError?: string | null;
    error?: string | null;
  };
  onClose?: () => void;
}

export default function TimelineEditor({
  initialNotes, bpm, gap, audioUrl, videoUrl, title, artist, draftId, onExport, exportStatus, onClose,
}: Props) {
  const { t } = useI18n();
  // Show the phrases the export will use, also for songs that never had them recorded
  const [notes, setNotes] = useState<EditorNote[]>(() =>
    hasLineMarks(initialNotes) ? initialNotes : inferLineStarts(initialNotes)
  );
  // Visible pitch range. Fitted once when the editor opens and only ever grows afterwards (one octave
  // when a note reaches an edge), so editing never makes the grid jump.
  const [range, setRange] = useState(() => fitRange(initialNotes));
  const [pxPitch, setPxPitch] = useState(PX_PITCH_DEFAULT);
  const pxPitchRef = useRef(pxPitch);
  useEffect(() => { pxPitchRef.current = pxPitch; }, [pxPitch]);
  const rangeRef = useRef(range);
  const prevHiRef = useRef(range.hi);
  useEffect(() => { rangeRef.current = range; }, [range]);
  useEffect(() => {
    let { lo, hi } = rangeRef.current;
    for (const n of notes) {
      if (n.pitch <= lo && lo > PITCH_MIN) lo = Math.max(PITCH_MIN, n.pitch - RANGE_MARGIN);
      if (n.pitch >= hi && hi < PITCH_MAX) hi = Math.min(PITCH_MAX, n.pitch + RANGE_MARGIN);
    }
    if (lo !== rangeRef.current.lo || hi !== rangeRef.current.hi) setRange({ lo, hi });
  }, [notes]);
  // Rows are laid out from the top: when rows are added above, keep what the user is looking at in place.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && range.hi !== prevHiRef.current) el.scrollBy({ top: (range.hi - prevHiRef.current) * pxPitchRef.current });
    prevHiRef.current = range.hi;
  }, [range.hi]);
  const rollH = (range.hi - range.lo + 1) * pxPitch;
  const pitchToY = (p: number) => (range.hi - p) * pxPitch;

  // The floating video thumbnail can be hidden; the choice lasts for the session.
  const [showVideo, setShowVideo] = useState(() => {
    try { return sessionStorage.getItem("ultrasongs.editor.video") !== "0"; } catch { return true; }
  });
  // The thumbnail floats over the roll and can be dragged elsewhere; double-click puts it back.
  // Offsets are measured from the editor's bottom-right corner, above the scrollbar and bottom bar.
  const [videoPos, setVideoPos] = useState<{ right: number; bottom: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ultrasongs.editor.videoPos") ?? "null");
      if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) return saved;
    } catch { /* ignore */ }
    return VIDEO_DEFAULT_POS;
  });
  const moveVideo = (pos: { right: number; bottom: number }) => {
    setVideoPos(pos);
    try { localStorage.setItem("ultrasongs.editor.videoPos", JSON.stringify(pos)); } catch { /* ignore */ }
  };
  const startVideoDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = e.currentTarget;
    const area = box.parentElement?.getBoundingClientRect();
    if (!area) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = videoPos;
    let last = origin;
    const onMove = (ev: MouseEvent) => {
      // Stays inside the editor
      const right = Math.max(0, Math.min(area.width - box.offsetWidth, origin.right - (ev.clientX - startX)));
      const bottom = Math.max(0, Math.min(area.height - box.offsetHeight, origin.bottom - (ev.clientY - startY)));
      last = { right, bottom };
      setVideoPos(last);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      moveVideo(last);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const toggleVideo = () =>
    setShowVideo((v) => {
      const next = !v;
      try { sessionStorage.setItem("ultrasongs.editor.video", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  // Selected notes; the last one is the "primary" the toolbar edits.
  const [followPlayhead, setFollowPlayhead] = useState(() => {
    try { return localStorage.getItem("ultrasongs.editor.follow") !== "0"; } catch { return true; }
  });
  const toggleFollow = (on: boolean) => {
    setFollowPlayhead(on);
    try { localStorage.setItem("ultrasongs.editor.follow", on ? "1" : "0"); } catch { /* ignore */ }
  };
  const [helpOpen, setHelpOpen] = useState(false);
  // The export result card stays until dismissed; a new export reopens it.
  const [exportNoticeOpen, setExportNoticeOpen] = useState(false);
  const helpOpenRef = useRef(false);
  useEffect(() => { helpOpenRef.current = helpOpen; }, [helpOpen]);
  const [selection, setSelection] = useState<string[]>([]);
  const selectionRef = useRef<string[]>([]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  const selectedId = selection.length > 0 ? selection[selection.length - 1] : null;
  const selectedSet = new Set(selection);
  const clipboardRef = useRef<EditorNote[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const suppressClickRef = useRef(false);
  // Undo/redo: snapshots of the notes taken just before each edit (a whole drag counts as one).
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const undoRef = useRef<EditorNote[][]>([]);
  const redoRef = useRef<EditorNote[][]>([]);
  const snapshot = useCallback(() => {
    undoRef.current.push(notesRef.current);
    if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
    redoRef.current = [];
  }, []);
  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(notesRef.current);
    setNotes(prev);
    setSelection((sel) => sel.filter((id) => prev.some((n) => n.id === id)));
  }, []);
  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(notesRef.current);
    setNotes(next);
    setSelection((sel) => sel.filter((id) => next.some((n) => n.id === id)));
  }, []);
  const syllableEditedRef = useRef(false);
  const [pxPerSec, setPxPerSec] = useState(PX_SEC_DEFAULT);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isNotePlaying, setIsNotePlaying] = useState(false);
  const [addMode, setAddMode] = useState(false);
  // Mixer: music is the audio element's volume; notes are synth tones (0 = off).
  const [musicVol, setMusicVol] = useState(1);
  const [noteVol, setNoteVol] = useState(0);
  // Muting keeps the slider where it was, so un-muting brings the previous level back.
  const [musicMuted, setMusicMuted] = useState(false);
  const [notesMuted, setNotesMuted] = useState(false);
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
    let lo = PITCH_MAX;
    let hi = PITCH_MIN;
    for (const n of initialNotes) {
      lo = Math.min(lo, n.pitch);
      hi = Math.max(hi, n.pitch);
    }
    const top = fitRange(initialNotes).hi;
    el.scrollTo({
      top: Math.max(0, (top - (lo + hi) / 2) * pxPitch + RULER_H - el.clientHeight / 2),
      left: Math.max(0, initialNotes[0].startSec * pxPerSec - 120),
    });
  }, [initialNotes, pxPerSec, pxPitch]);
  // Zooming keeps the centre of the view where it was, instead of drifting towards the origin.
  const prevZoomRef = useRef({ pps: pxPerSec, pitch: pxPitch });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevZoomRef.current;
    prevZoomRef.current = { pps: pxPerSec, pitch: pxPitch };
    if (!el) return;
    if (prev.pps !== pxPerSec) {
      const half = (el.clientWidth - KEYS_W) / 2;
      el.scrollTo({ left: ((el.scrollLeft + half) / prev.pps) * pxPerSec - half });
    }
    if (prev.pitch !== pxPitch) {
      const half = (el.clientHeight - RULER_H) / 2;
      el.scrollTo({ top: ((el.scrollTop + half) / prev.pitch) * pxPitch - half });
    }
  }, [pxPerSec, pxPitch]);
  const rafRef = useRef(0);
  const micRafRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const notePlayCtxRef = useRef<AudioContext | null>(null);
  const notePlayStartRef = useRef<number>(0);
  const notePlayOffsetRef = useRef<number>(0);
  // Whichever tone scheduler is running (song + notes, or notes only); seeks reset it.
  const toneSchedulerRef = useRef<ReturnType<typeof createToneScheduler> | null>(null);
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
    toneSchedulerRef.current?.stop();
    toneSchedulerRef.current = null;
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
  // While the song plays with "Notas" on, synth tones are scheduled on a separate AudioContext
  // against the audio element's clock, a few hundred ms ahead. Seeks reset the scheduler and edits
  // made mid-playback are picked up as playback reaches them.
  const mixNotesRef = useRef<EditorNote[]>(notes);
  useEffect(() => { mixNotesRef.current = notes; }, [notes]);
  const noteMasterRef = useRef<GainNode | null>(null);
  const noteVolRef = useRef(noteVol);
  useEffect(() => {
    noteVolRef.current = notesMuted ? 0 : noteVol;
    if (noteMasterRef.current) noteMasterRef.current.gain.value = noteVolRef.current;
  }, [noteVol, notesMuted]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = musicMuted ? 0 : musicVol;
  }, [musicVol, musicMuted]);

  const notesAudible = noteVol > 0;

  useEffect(() => {
    if (!isPlaying || !notesAudible) return;
    const a = audioRef.current;
    if (!a) return;

    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = noteVolRef.current;
    master.connect(ctx.destination);
    noteMasterRef.current = master;

    const scheduler = createToneScheduler(ctx, master, () => a.currentTime, () => mixNotesRef.current);
    toneSchedulerRef.current = scheduler;

    return () => {
      scheduler.stop();
      if (toneSchedulerRef.current === scheduler) toneSchedulerRef.current = null;
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
    notePlayStartRef.current = ctx.currentTime;
    notePlayOffsetRef.current = playheadSec;
    toneSchedulerRef.current = createToneScheduler(
      ctx,
      ctx.destination,
      () => notePlayOffsetRef.current + (ctx.currentTime - notePlayStartRef.current),
      () => mixNotesRef.current
    );

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
  }, [isNotePlaying, isPlaying, playheadSec, duration, stopNotePlay]);

  const seekTo = useCallback((sec: number) => {
    const clamped = Math.max(0, sec);
    setPlayheadSec(clamped);
    // Notes-only playback runs on its own clock: move it too, and drop tones scheduled for the old spot
    if (notePlayCtxRef.current) {
      notePlayOffsetRef.current = clamped;
      notePlayStartRef.current = notePlayCtxRef.current.currentTime;
    }
    toneSchedulerRef.current?.reset();
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

  // Auto-scroll playhead into view (optional: some people prefer to keep the view where they put it)
  useEffect(() => {
    if (!followPlayhead || (!isPlaying && !isNotePlaying) || !scrollRef.current) return;
    const x = playheadSec * pxPerSec;
    const container = scrollRef.current;
    const visible = container.scrollLeft + container.clientWidth - KEYS_W;
    if (x > visible - 40 || x < container.scrollLeft) {
      container.scrollTo({ left: Math.max(0, x - 80) });
    }
  }, [followPlayhead, isPlaying, isNotePlaying, playheadSec, pxPerSec]);

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
      const valid = shifted !== null && shifted >= MIC_MIN_PITCH && shifted <= MIC_MAX_PITCH ? shifted : null;
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
    snapshot();
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
        return { ...note, pitch: Math.max(MIC_MIN_PITCH, Math.min(MIC_MAX_PITCH, normalized)) };
      })
    );
  }, [micTrace, snapshot]);

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

  const addModeRef = useRef(false);
  useEffect(() => { addModeRef.current = addMode; }, [addMode]);

  // ── Drag note (move / resize) ─────────────────────────────────────────────
  // Moving drags every selected note together; shift/ctrl-click adds or removes a note from the selection.
  const startDrag = useCallback(
    (e: React.MouseEvent, note: EditorNote, kind: "move" | "resize" | "resizeLeft") => {
      e.preventDefault();
      e.stopPropagation();
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const wasSelected = selectionRef.current.includes(note.id);
      let group: string[];
      if (kind !== "move") {
        group = [note.id];
        if (!wasSelected) setSelection([note.id]);
      } else if (additive) {
        if (wasSelected) {
          setSelection((prev) => prev.filter((id) => id !== note.id));
          return;
        }
        group = [...selectionRef.current, note.id];
        setSelection(group);
      } else if (wasSelected) {
        group = selectionRef.current;
      } else {
        group = [note.id];
        setSelection(group);
      }

      const origin = new Map<string, { startSec: number; pitch: number }>();
      for (const n of mixNotesRef.current) {
        if (group.includes(n.id)) origin.set(n.id, { startSec: n.startSec, pitch: n.pitch });
      }
      let minStart = Infinity;
      let minPitch = Infinity;
      let maxPitch = -Infinity;
      for (const o of origin.values()) {
        minStart = Math.min(minStart, o.startSec);
        minPitch = Math.min(minPitch, o.pitch);
        maxPitch = Math.max(maxPitch, o.pitch);
      }
      const startX = e.clientX;
      const startY = e.clientY;
      const baseDuration = note.durationSec;
      const baseStart = note.startSec;
      const baseEnd = note.startSec + note.durationSec;
      let moved = false;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return; // a click, not a drag
        if (!moved) snapshot();
        moved = true;
        const pps = pxPerSecRef.current;
        if (kind === "resize") {
          setNotes((prev) =>
            prev.map((n) => (n.id === note.id ? { ...n, durationSec: Math.max(0.05, baseDuration + dx / pps) } : n))
          );
          return;
        }
        if (kind === "resizeLeft") {
          // The end stays put: only the start moves (never before 0, never past the end)
          const start = Math.max(0, Math.min(baseEnd - 0.05, baseStart + dx / pps));
          setNotes((prev) =>
            prev.map((n) => (n.id === note.id ? { ...n, startSec: start, durationSec: baseEnd - start } : n))
          );
          return;
        }
        const { lo, hi } = rangeRef.current;
        // The group moves as one block: it stops at time 0 and at the edges of the pitch range
        const dSec = Math.max(dx / pps, -minStart);
        const dPitch = Math.max(lo - minPitch, Math.min(hi - maxPitch, -Math.round(dy / pxPitchRef.current)));
        setNotes((prev) =>
          prev.map((n) => {
            const o = origin.get(n.id);
            return o ? { ...n, startSec: o.startSec + dSec, pitch: o.pitch + dPitch } : n;
          })
        );
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        // A plain click on a note of a group narrows the selection to that note
        if (!moved && kind === "move" && !additive && group.length > 1) setSelection([note.id]);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [snapshot]
  );

  // ── Rubber-band selection on empty grid ───────────────────────────────────
  const startMarquee = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || addModeRef.current) return;
    e.preventDefault();
    const grid = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const base = e.shiftKey || e.ctrlKey || e.metaKey ? selectionRef.current : [];
    // Grid-local coordinates, so the box stays attached to the content while the roll scrolls
    const local = (cx: number, cy: number) => {
      const r = grid.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    };
    const anchor = local(startX, startY);
    let active = false;
    const onMove = (ev: MouseEvent) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      active = true;
      const c = local(ev.clientX, ev.clientY);
      const box = {
        x0: Math.min(anchor.x, c.x), x1: Math.max(anchor.x, c.x),
        y0: Math.min(anchor.y, c.y), y1: Math.max(anchor.y, c.y),
      };
      setMarquee(box);
      const pps = pxPerSecRef.current;
      const rowH = pxPitchRef.current;
      const hi = rangeRef.current.hi;
      const hit = mixNotesRef.current
        .filter((n) => {
          const nx0 = n.startSec * pps;
          const ny0 = (hi - n.pitch) * rowH;
          return nx0 + n.durationSec * pps >= box.x0 && nx0 <= box.x1 && ny0 + rowH >= box.y0 && ny0 <= box.y1;
        })
        .map((n) => n.id)
        .filter((id) => !base.includes(id));
      setSelection([...base, ...hit]);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (active) {
        setMarquee(null);
        // The click that follows this mouseup must not also seek or clear the selection
        suppressClickRef.current = true;
        setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

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

  const handleGridClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (suppressClickRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (addModeRef.current) {
        const sec = Math.max(0, (e.clientX - rect.left) / pxPerSecRef.current);
        const yRel = e.clientY - rect.top;
        const { lo, hi } = rangeRef.current;
        const pitch = Math.max(lo, Math.min(hi, Math.round(hi - yRel / pxPitchRef.current)));
        const id = crypto.randomUUID();
        const newNote: EditorNote = { id, startSec: sec, durationSec: 0.3, pitch, syllable: "+", type: ":" };
        snapshot();
        setNotes((prev) => [...prev, newNote].sort((a, b) => a.startSec - b.startSec));
        setSelection([id]);
        setTimeout(() => { syllableInputRef.current?.focus(); syllableInputRef.current?.select(); }, 0);
      } else {
        const sec = (e.clientX - rect.left) / pxPerSecRef.current;
        seekTo(sec);
      }
    },
    [seekTo, snapshot]
  );

  // ── Split selected note ───────────────────────────────────────────────────
  const splitSelected = useCallback(() => {
    if (!selectedId) return;
    snapshot();
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === selectedId);
      if (idx === -1) return prev;
      const n = prev[idx];
      const half = n.durationSec / 2;
      const cut = Math.ceil(n.syllable.length / 2);
      const a: EditorNote = { ...n, durationSec: half, syllable: n.syllable.slice(0, cut) };
      const b: EditorNote = {
        ...n, id: crypto.randomUUID(), startSec: n.startSec + half,
        durationSec: half, syllable: n.syllable.slice(cut), lineStart: false,
      };
      const result = [...prev];
      result.splice(idx, 1, a, b);
      return result;
    });
  }, [selectedId, snapshot]);

  // ── Phrase end before an instrumental part ───────────────────────────────
  // Marks the selected notes as the last of their phrase (the break is exported right after them)
  // and makes the next note open a new phrase.
  const toggleBreakAfter = useCallback(() => {
    const ids = new Set(selectionRef.current);
    const primary = mixNotesRef.current.find((n) => n.id === selectionRef.current[selectionRef.current.length - 1]);
    if (!primary) return;
    const on = !primary.breakAfter;
    snapshot();
    setNotes((prev) => {
      const order = [...prev].sort((a, b) => a.startSec - b.startSec);
      const opens = new Set<string>();
      if (on) {
        order.forEach((n, i) => {
          if (ids.has(n.id) && order[i + 1]) opens.add(order[i + 1].id);
        });
      }
      return prev.map((n) => {
        if (ids.has(n.id)) return { ...n, breakAfter: on };
        if (opens.has(n.id)) return { ...n, lineStart: true };
        return n;
      });
    });
  }, [snapshot]);

  // ── Copy / paste ──────────────────────────────────────────────────────────
  // Copies keep their pitch and their spacing; pasting drops the first one at the playhead.
  const copySelection = useCallback(() => {
    const ids = new Set(selectionRef.current);
    const picked = mixNotesRef.current.filter((n) => ids.has(n.id));
    if (picked.length > 0) clipboardRef.current = picked.map((n) => ({ ...n }));
    return picked.length > 0;
  }, []);

  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (clip.length === 0) return;
    const first = Math.min(...clip.map((n) => n.startSec));
    const at = playheadSecRef.current;
    const pasted = clip.map((n) => ({ ...n, id: crypto.randomUUID(), startSec: Math.max(0, n.startSec - first + at) }));
    snapshot();
    setNotes((prev) => [...prev, ...pasted].sort((a, b) => a.startSec - b.startSec));
    setSelection(pasted.map((n) => n.id));
  }, [snapshot]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only text entry keeps its keys. Sliders, buttons and selects that still have focus after a
      // click must not swallow Space (play/pause) or the editing shortcuts.
      if (helpOpenRef.current) return; // the help dialog owns the keyboard (Esc closes it)
      const el = e.target as HTMLElement;
      const typing =
        el.isContentEditable ||
        el.tagName === "TEXTAREA" ||
        (el.tagName === "INPUT" && !["range", "checkbox", "radio", "button"].includes((el as HTMLInputElement).type));
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      const ids = new Set(selection);
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.code === "Escape" && selection.length > 0) setSelection([]);
      if (mod && (e.code === "KeyZ" || e.code === "KeyY")) {
        e.preventDefault();
        if (e.code === "KeyY" || e.shiftKey) redo();
        else undo();
      }
      if (mod && e.code === "KeyA") {
        e.preventDefault();
        setSelection(mixNotesRef.current.map((n) => n.id));
      }
      if (mod && e.code === "KeyC") {
        e.preventDefault();
        copySelection();
      }
      if (mod && e.code === "KeyX" && copySelection()) {
        e.preventDefault();
        snapshot();
        setNotes((prev) => selection.reduce((acc, id) => withoutNote(acc, id), prev));
        setSelection([]);
      }
      if (mod && e.code === "KeyV") {
        e.preventDefault();
        pasteClipboard();
      }
      if ((e.code === "Delete" || e.code === "Backspace") && selection.length > 0) {
        snapshot();
        setNotes((prev) => selection.reduce((acc, id) => withoutNote(acc, id), prev));
        setSelection([]);
      }
      if (e.code === "KeyS" && !mod && selectedId) {
        e.preventDefault();
        splitSelected();
      }
      // L: this note opens a new phrase (a "-" line goes before it)
      if (e.code === "KeyL" && !mod && selection.length > 0) {
        e.preventDefault();
        snapshot();
        setNotes((prev) => prev.map((n) => (ids.has(n.id) ? { ...n, lineStart: !n.lineStart } : n)));
      }
      // B: phrase ends after this note (an instrumental part follows)
      if (e.code === "KeyB" && !mod && selection.length > 0) {
        e.preventDefault();
        toggleBreakAfter();
      }
      // G: golden on/off (rap notes keep their rap kind); F: freestyle on/off
      if ((e.code === "KeyG" || e.code === "KeyF") && !mod && selection.length > 0) {
        e.preventDefault();
        const golden: Record<NoteType, NoteType> = { ":": "*", "*": ":", F: "*", R: "G", G: "R" };
        snapshot();
        setNotes((prev) =>
          prev.map((n) => {
            if (!ids.has(n.id)) return n;
            if (e.code === "KeyG") return { ...n, type: golden[n.type] };
            return { ...n, type: n.type === "F" ? ":" : "F" };
          })
        );
      }
    };
    // A focused button would also "click" on Space release, toggling it on top of play/pause
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && (e.target as HTMLElement).tagName === "BUTTON") e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [togglePlay, selection, selectedId, splitSelected, copySelection, pasteClipboard, toggleBreakAfter, snapshot, undo, redo]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const playheadX = KEYS_W + playheadSec * pxPerSec;
  const micY = micMidi !== null ? pitchToY(micMidi) + pxPitch / 2 : null;

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

  const firstStart = notes.reduce((m, n) => Math.min(m, n.startSec), Infinity);
  // Shared control sizes: every small control in the bar is 32 px tall
  const chip =
    "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-800 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";
  const squareBtn =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm transition-colors";
  const divider = "hidden h-7 w-px bg-zinc-800 lg:block";

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-zinc-950">
      {/* ── Toolbar: one compact bar, grouped (title · playback · navigation · editing · microphone · file) ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-xs">
        <div className="min-w-0 max-w-[12rem] shrink">
          <span className="block truncate text-sm font-semibold text-zinc-50">{title}</span>
          <span className="block truncate text-xs text-zinc-400">{artist}</span>
        </div>

        <span className={divider} aria-hidden />

        {/* Playback */}
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-500"
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
            onClick={toggleNotePlay}
            title={t("editor.notesOnlyTitle")}
            className={`${squareBtn} ${
              isNotePlaying ? "bg-amber-500 text-white hover:bg-amber-400" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            ♪
          </button>
          <div title={t("editor.musicTitle")} className="flex select-none items-center gap-1.5 text-zinc-300">
            <button
              onClick={() => setMusicMuted((m) => !m)}
              aria-pressed={musicMuted}
              title={musicMuted ? t("editor.unmute") : t("editor.mute")}
              className={`${chip} !px-2 ${musicMuted ? "!border-red-900 !bg-red-950 !text-red-300 line-through" : ""}`}
            >
              {t("editor.music")}
            </button>
            <RangeSlider
              value={musicMuted ? 0 : musicVol} max={1} step={0.05}
              onChange={(v) => { setMusicVol(v); if (v > 0) setMusicMuted(false); }}
              label={t("editor.music")} className="w-16"
            />
          </div>
          <div title={t("editor.notesTitle")} className="flex select-none items-center gap-1.5 text-zinc-300">
            <button
              onClick={() => setNotesMuted((m) => !m)}
              aria-pressed={notesMuted}
              title={notesMuted ? t("editor.unmute") : t("editor.mute")}
              className={`${chip} !px-2 ${notesMuted ? "!border-red-900 !bg-red-950 !text-red-300 line-through" : ""}`}
            >
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {t("editor.notes")}
            </button>
            <RangeSlider
              value={notesMuted ? 0 : noteVol} max={1} step={0.05}
              onChange={(v) => { setNoteVol(v); if (v > 0) setNotesMuted(false); }}
              label={t("editor.notes")} color="#f59e0b" className="w-16"
            />
          </div>
        </div>

        <span className={divider} aria-hidden />

        {/* Navigation */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums text-zinc-100">
            {fmtClock(playheadSec, true)} <span className="text-zinc-500">/ {fmtClock(duration)}</span>
          </span>
          <RangeSlider
            value={Math.min(playheadSec, duration)} max={duration} step={0.01}
            onChange={seekTo} label={t("player.seek")} className="w-32"
          />
          <label className="flex items-center gap-2 text-zinc-400">
            <span>{t("editor.zoom")}</span>
            <RangeSlider
              value={pxPerSec} max={PX_SEC_MAX} step={10}
              onChange={(v) => setPxPerSec(Math.max(PX_SEC_MIN, v))}
              label={t("editor.zoom")} className="w-20"
            />
          </label>
          <label className="flex select-none items-center gap-1.5 text-zinc-400" title={t("editor.followTitle")}>
            <input
              type="checkbox"
              checked={followPlayhead}
              onChange={(e) => toggleFollow(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-500"
            />
            <span>{t("editor.follow")}</span>
          </label>
          <label className="flex items-center gap-2 text-zinc-400" title={t("editor.zoomVTitle")}>
            <span>{t("editor.zoomV")}</span>
            <RangeSlider
              value={pxPitch} max={PX_PITCH_MAX} step={1}
              onChange={(v) => setPxPitch(Math.max(PX_PITCH_MIN, v))}
              label={t("editor.zoomV")} className="w-20"
            />
          </label>
        </div>

        <span className={divider} aria-hidden />

        {/* Note editing */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setAddMode((v) => !v)}
            title={t("editor.addNoteTitle")}
            aria-pressed={addMode}
            className={`${squareBtn} text-base font-bold ${
              addMode ? "bg-emerald-500 text-white hover:bg-emerald-400" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            +
          </button>

        </div>

        <span className={divider} aria-hidden />

        {/* Microphone */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={toggleMic}
            title={micLabel || undefined}
            aria-pressed={micEnabled}
            className={`${chip} ${micEnabled ? "!border-green-700 !bg-green-950 !text-green-300" : ""}`}
          >
            🎤 {micEnabled ? (micLabel ? micLabel.split("(")[0].trim() : t("editor.micOn")) : t("editor.mic")}
          </button>
          {micEnabled && (
            <label className="flex items-center gap-1.5 text-zinc-400" title={t("editor.micSensitivityTitle")}>
              <span>{t("editor.micSensitivity")}</span>
              <RangeSlider
                value={micThreshold} max={0.08} step={0.005}
                onChange={(v) => setMicThreshold(Math.max(0.005, v))}
                label={t("editor.micSensitivity")} color="#22c55e" className="w-14"
              />
            </label>
          )}
          {micEnabled && (
            <div className="flex items-center gap-1">
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
              aria-pressed={micPlayEnabled}
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
              className="h-8 max-w-40 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 text-xs text-zinc-200"
            >
              {micDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || t("editor.micDevice", { id: d.deviceId.slice(0, 6) })}
                </option>
              ))}
            </select>
          )}
          {micEnabled && (
            <span className="text-green-400">
              {micMidi !== null ? noteName(micMidi) : "—"}
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
              <button onClick={applyMicTrace} className={`${chip} !border-green-700 !bg-green-600 !text-white hover:!bg-green-500`}>
                {t("editor.applyMic")}
              </button>
              <button onClick={() => { setMicTrace([]); micPendingRef.current = []; }} className={chip}>
                {t("editor.clear")}
              </button>
            </div>
          )}
        </div>

        {/* File and view */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setHelpOpen(true)}
            title={t("editor.helpButton")}
            aria-label={t("editor.helpButton")}
            className={`${squareBtn} bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100`}
          >
            ?
          </button>
          {videoUrl && (
            <button
              onClick={toggleVideo}
              title={showVideo ? t("editor.videoHide") : t("editor.videoShow")}
              aria-label={showVideo ? t("editor.videoHide") : t("editor.videoShow")}
              aria-pressed={showVideo}
              className={`${squareBtn} ${showVideo ? "bg-zinc-700 text-zinc-100" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"}`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="14" height="12" rx="2" />
                <path d="M16 10l6-3v10l-6-3z" />
              </svg>
            </button>
          )}
          {draftId && (
            <button
              onClick={saveDraft}
              disabled={saveStatus === "saving"}
              className={`btn !h-8 !px-3 !py-0 text-xs ${
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
          <button
            onClick={() => { setExportNoticeOpen(true); onExport(notes, bpm, gap); }}
            disabled={exportStatus?.busy}
            className="btn btn-primary !h-8 !px-3 !py-0 text-xs"
          >
            {exportStatus?.busy ? t("editor.exporting") : t("editor.export")}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label={t("action.close")}
              className={`${squareBtn} text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Piano roll ── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-zinc-950">
        {/* Time ruler: sticks to the top while the roll scrolls vertically */}
        <div
          className="sticky top-0 z-50 cursor-col-resize select-none border-b border-zinc-800 bg-zinc-900"
          style={{ width: totalW, height: RULER_H }}
          onMouseDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const toSec = (clientX: number) => Math.max(0, (clientX - rect.left - KEYS_W) / pxPerSecRef.current);
            e.preventDefault();
            seekTo(toSec(e.clientX));
            const onMove = (ev: MouseEvent) => seekTo(toSec(ev.clientX));
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
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

        <div style={{ width: totalW, height: rollH, position: "relative" }}>

          {/* Piano keys */}
          <div style={{ position: "sticky", left: 0, top: 0, width: KEYS_W, height: rollH, zIndex: 20, flexShrink: 0 }}>
            {Array.from({ length: range.hi - range.lo + 1 }, (_, i) => {
              const p = range.hi - i;
              const black = isBlack(p);
              const highlighted = micMidi === p;
              const isC = p % 12 === 0;
              return (
                <div
                  key={p}
                  style={{ position: "absolute", top: i * pxPitch, left: 0, width: KEYS_W - 1, height: pxPitch }}
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
            style={{ position: "absolute", left: KEYS_W, top: 0, right: 0, height: rollH, zIndex: 1, cursor: addMode ? "crosshair" : "default" }}
            onClick={handleGridClick}
            onMouseDown={startMarquee}
          >
            {Array.from({ length: range.hi - range.lo + 1 }, (_, i) => {
              const p = range.hi - i;
              return (
                <div
                  key={p}
                  style={{ position: "absolute", top: i * pxPitch, left: 0, right: 0, height: pxPitch }}
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
                top: pitchToY(pt.midi) + pxPitch / 2 - 2,
                width: 4, height: 4,
                borderRadius: "50%",
                background: "rgba(34,197,94,0.65)",
                zIndex: 15,
                pointerEvents: "none",
              }}
            />
          ))}

          {/* Phrase starts: a dashed line just before the first note of each phrase */}
          {notes.map((n) =>
            n.lineStart && n.startSec > firstStart + 1e-6 ? (
              <div
                key={`phrase-${n.id}`}
                style={{
                  position: "absolute", left: KEYS_W + n.startSec * pxPerSec - 3, top: 0, height: rollH,
                  borderLeft: "1px dashed rgba(168,85,247,0.65)", zIndex: 5, pointerEvents: "none",
                }}
              />
            ) : null
          )}

          {/* Phrase ends before an instrumental part: a dashed line right after the note */}
          {notes.map((n) =>
            n.breakAfter ? (
              <div
                key={`break-${n.id}`}
                title={t("editor.endPhraseTitle")}
                style={{
                  position: "absolute", left: KEYS_W + (n.startSec + n.durationSec) * pxPerSec + 2, top: 0, height: rollH,
                  borderLeft: "1px dashed rgba(245,158,11,0.8)", zIndex: 5, pointerEvents: "none",
                }}
              />
            ) : null
          )}

          {/* Notes */}
          {notes.map((note) => {
            const x = KEYS_W + note.startSec * pxPerSec;
            const y = pitchToY(note.pitch);
            const w = note.durationSec * pxPerSec;
            const sel = selectedSet.has(note.id);
            return (
              <div
                key={note.id}
                style={{
                  position: "absolute", left: x + 1, top: y + 2,
                  width: Math.max(w - 2, 8), height: pxPitch - 4,
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
                {/* Resize handles: left keeps the end fixed, right keeps the start fixed */}
                <div
                  style={{ position: "absolute", left: 0, top: 0, width: Math.min(6, w / 3), height: "100%", cursor: "ew-resize" }}
                  onMouseDown={(e) => startDrag(e, note, "resizeLeft")}
                />
                <div
                  style={{ position: "absolute", right: 0, top: 0, width: 6, height: "100%", cursor: "ew-resize" }}
                  onMouseDown={(e) => startDrag(e, note, "resize")}
                />
              </div>
            );
          })}

          {/* Playhead: the grab area sits under the notes, so a note next to it is never stolen */}
          <div
            style={{
              position: "absolute", left: playheadX - 6, top: 0,
              width: 12, height: rollH,
              zIndex: 8, cursor: "col-resize",
            }}
            onMouseDown={startPlayheadDrag}
          />
          <div
            style={{
              position: "absolute", left: playheadX - 1, top: 0, width: 2, height: rollH,
              background: "#ef4444", zIndex: 40, pointerEvents: "none",
            }}
          />

          {/* Rubber-band selection */}
          {marquee && (
            <div
              style={{
                position: "absolute", left: KEYS_W + marquee.x0, top: marquee.y0,
                width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0,
                border: "1px solid #60a5fa", background: "rgba(59,130,246,0.15)", zIndex: 45, pointerEvents: "none",
              }}
            />
          )}

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
        <div
          onMouseDown={startVideoDrag}
          onDoubleClick={() => moveVideo(VIDEO_DEFAULT_POS)}
          title={t("editor.videoMoveTitle")}
          style={{ right: videoPos.right, bottom: videoPos.bottom, cursor: "grab" }}
          className={`absolute z-50 w-60 select-none overflow-hidden rounded-lg border border-zinc-700 bg-black shadow-2xl shadow-black/60 ${
            showVideo ? "" : "hidden"
          }`}
        >
          <video ref={videoRef} src={videoUrl} muted className="pointer-events-none aspect-video w-full object-contain" />
        </div>
      )}

      {/* Fixed height: the note editor lives here, not in the toolbar, so selecting a note never shifts the roll */}
      <div className="flex h-12 items-center overflow-x-auto border-t border-zinc-800 bg-zinc-900 px-4 text-xs text-zinc-400">
        {/* Always there (disabled with nothing selected), so the bar never changes shape under the mouse */}
        <fieldset disabled={!selectedNote} className={`flex shrink-0 items-center gap-1.5 ${selectedNote ? "" : "opacity-50"}`}>
              {selection.length > 1 ? (
                <span className="px-1 font-medium text-blue-300">{t("editor.selectedCount", { n: selection.length })}</span>
              ) : (
                !selectedNote && <span className="px-1">{t("editor.noSelection")}</span>
              )}
              <input
                ref={syllableInputRef}
                value={selectedNote?.syllable ?? ""}
                onFocus={() => { syllableEditedRef.current = false; }}
                onChange={(e) => {
                  // One undo step per editing session of the field
                  if (!syllableEditedRef.current) { snapshot(); syllableEditedRef.current = true; }
                  const value = e.target.value;
                  setNotes((prev) => prev.map((n) => (n.id === selectedId ? { ...n, syllable: value } : n)));
                }}
                placeholder={t("editor.syllable")}
                className="h-8 w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
              <button onClick={splitSelected} title={t("editor.splitTitle")} className={chip}>
                {t("editor.split")}
              </button>
              <button
                onClick={() => {
                  const ids = new Set(selection);
                  const next = !selectedNote?.lineStart;
                  snapshot();
                  setNotes((prev) => prev.map((n) => (ids.has(n.id) ? { ...n, lineStart: next } : n)));
                }}
                title={t("editor.newPhraseTitle")}
                aria-pressed={!!selectedNote?.lineStart}
                className={`${chip} ${selectedNote?.lineStart ? "!border-violet-600 !bg-violet-950 !text-violet-200" : ""}`}
              >
                ¶ {t("editor.newPhrase")}
              </button>
              <button
                onClick={toggleBreakAfter}
                title={t("editor.endPhraseTitle")}
                aria-pressed={!!selectedNote?.breakAfter}
                className={`${chip} ${selectedNote?.breakAfter ? "!border-amber-600 !bg-amber-950 !text-amber-200" : ""}`}
              >
                ⏎ {t("editor.endPhrase")}
              </button>
              <select
                value={selectedNote?.type ?? ":"}
                onChange={(e) => {
                  const ids = new Set(selection);
                  const type = e.target.value as NoteType;
                  snapshot();
                  setNotes((prev) => prev.map((n) => (ids.has(n.id) ? { ...n, type } : n)));
                }}
                className="h-8 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 text-xs text-zinc-200"
              >
                <option value=":">{t("editor.noteNormal")}</option>
                <option value="*">★ {t("editor.noteGolden")}</option>
                <option value="F">{t("editor.noteFreestyle")}</option>
                <option value="R">{t("editor.noteRap")}</option>
                <option value="G">★ {t("editor.noteRapGolden")}</option>
              </select>
              <button
                onClick={() => {
                  snapshot();
                  setNotes((prev) => selection.reduce((acc, id) => withoutNote(acc, id), prev));
                  setSelection([]);
                }}
                title={t("editor.deleteTitle")}
                className={`${chip} !border-red-900 !bg-transparent !text-red-400 hover:!bg-red-950`}
              >
                {t("editor.delete")}
              </button>
        </fieldset>
        <span className="ml-4 hidden min-w-0 truncate 2xl:block">{t("editor.help")}</span>
      </div>

      {/* Export result: the page that normally shows it is hidden behind the editor */}
      {exportNoticeOpen && exportStatus && (exportStatus.busy || exportStatus.url || exportStatus.error) && (
        <div
          role="status"
          className="absolute bottom-16 left-1/2 z-[60] flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm shadow-2xl shadow-black/60"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {exportStatus.busy ? (
              <span className="text-zinc-200">{t("editor.exporting")}…</span>
            ) : exportStatus.error ? (
              <span className="text-red-400">{exportStatus.error}</span>
            ) : (
              <>
                <span className="font-medium text-green-400">{t("editor.exportReady")}</span>
                {exportStatus.savedTo && (
                  <span className="text-xs text-zinc-300">
                    {t("download.savedTo")} <span className="break-all font-mono">{exportStatus.savedTo}</span>
                  </span>
                )}
                {exportStatus.saveError && (
                  <span className="text-xs text-amber-400">
                    {t("download.saveError")} {exportStatus.saveError}
                  </span>
                )}
                {exportStatus.url && (
                  <a
                    href={exportStatus.url}
                    download={exportStatus.filename}
                    className="btn btn-secondary !h-8 w-fit !px-3 !py-0 text-xs"
                  >
                    {t("download.button", { filename: exportStatus.filename })}
                  </a>
                )}
              </>
            )}
          </div>
          {!exportStatus.busy && (
            <button
              onClick={() => setExportNoticeOpen(false)}
              aria-label={t("action.close")}
              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      <EditorHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

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
