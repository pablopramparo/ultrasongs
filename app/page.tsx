"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import FileUpload from "./components/FileUpload";
import LyricsInput from "./components/LyricsInput";
import GenerateButton from "./components/GenerateButton";
import DownloadPanel from "./components/DownloadPanel";
import TimelineEditor from "./components/TimelineEditor";
import DraftsSidebar from "./components/DraftsSidebar";
import type { WordTimestamp } from "./api/transcribe/route";
import type { EditorNote } from "./lib/editorNote";

type Phase = "idle" | "uploading" | "transcribing" | "generating" | "done" | "error";

interface UploadResult { id: string; mp3: string; videoPath?: string; vocalsPath?: string; accompanimentPath?: string }
interface TranscribeResult { words: WordTimestamp[]; language: string; vocalsPath?: string; accompanimentPath?: string; pauses?: Array<{ start: number; end: number }> }
interface AlignResult { notes: EditorNote[]; bpm: number; gap: number }

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");

  const [pendingAudioFile, setPendingAudioFile] = useState<File | null>(null);
  const [pendingVideoFile, setPendingVideoFile] = useState<File | null>(null);
  const [filename, setFilename] = useState("");
  const [videoFilename, setVideoFilename] = useState("");

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const [transcribed, setTranscribed] = useState(false);
  const [currentStage, setCurrentStage] = useState("");
  const [transcribeElapsed, setTranscribeElapsed] = useState(0);

  const [editorOpen, setEditorOpen] = useState(false);
  const [alignResult, setAlignResult] = useState<AlignResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);

  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  // true when audio is already on the server (from a saved draft or prior upload)
  const [hasUploadedAudio, setHasUploadedAudio] = useState(false);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [newFormOpen, setNewFormOpen] = useState(false);

  const uploadRef = useRef<UploadResult | null>(null);
  const transcribeRef = useRef<TranscribeResult | null>(null);
  const prevDownloadUrl = useRef<string | null>(null);
  const infoAudioRef = useRef<HTMLAudioElement | null>(null);
  const infoVideoRef = useRef<HTMLVideoElement | null>(null);

  // Sync info-card video to audio player
  useEffect(() => {
    const audio = infoAudioRef.current;
    const video = infoVideoRef.current;
    if (!audio || !video) return;
    const onPlay = () => { video.currentTime = audio.currentTime; video.play().catch(() => {}); };
    const onPause = () => video.pause();
    const onSeeked = () => { video.currentTime = audio.currentTime; };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("seeked", onSeeked);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("seeked", onSeeked);
    };
  }, [transcribed, audioUrl, videoUrl]);

  // Elapsed timer — runs during transcribing phase
  useEffect(() => {
    if (phase !== "transcribing") return;
    const startedAt = Date.now();
    const t = setInterval(() => setTranscribeElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => {
      clearInterval(t);
      setTranscribeElapsed(0);
    };
  }, [phase]);

  const busy = phase === "uploading" || phase === "transcribing" || phase === "generating";
  const canProcess = (!!pendingAudioFile || hasUploadedAudio) && !!title.trim() && !!artist.trim() && !!lyrics.trim() && !busy;
  const canAct = transcribed && !!lyrics.trim() && !!title.trim() && !!artist.trim() && !busy;

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ── Save draft ───────────────────────────────────────────────────────────
  const handleSaveDraft = useCallback(async () => {
    if (!transcribeRef.current || !uploadRef.current) return;
    setSaving(true);
    try {
      // Get align result if not already open in the editor
      let ar = alignResult;
      if (!ar) {
        const res = await fetch("/api/align", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mp3: uploadRef.current.mp3,
            words: transcribeRef.current.words,
            language: transcribeRef.current.language,
            lyrics,
            pauses: transcribeRef.current.pauses,
          }),
        });
        if (res.ok) { ar = await res.json(); setAlignResult(ar); }
      }
      if (!ar) return;

      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: currentDraftId ?? undefined,
          title, artist, lyrics,
          bpm: ar.bpm, gap: ar.gap, notes: ar.notes,
          words: transcribeRef.current.words,
          language: transcribeRef.current.language,
          pauses: transcribeRef.current.pauses ?? [],
          mp3: uploadRef.current.mp3,
          videoPath: uploadRef.current.videoPath,
          vocalsPath: uploadRef.current.vocalsPath,
          accompanimentPath: uploadRef.current.accompanimentPath,
        }),
      });
      if (res.ok) {
        const { id } = await res.json();
        setCurrentDraftId(id);
        setDraftsRefreshKey((k) => k + 1);
      }
    } finally {
      setSaving(false);
    }
  }, [alignResult, title, artist, lyrics, currentDraftId]);

  // ── Load draft ───────────────────────────────────────────────────────────
  const handleLoadDraft = useCallback(async (id: string) => {
    const res = await fetch(`/api/drafts/${id}`);
    if (!res.ok) return;
    const draft = await res.json();

    setTitle(draft.title ?? "");
    setArtist(draft.artist ?? "");
    setLyrics(draft.lyrics ?? "");
    setFilename("audio.mp3");
    setVideoFilename(draft.videoPath ? "video" : "");

    uploadRef.current = {
      id: draft.id,
      mp3: draft.mp3,
      videoPath: draft.videoPath,
      vocalsPath: draft.vocalsPath,
      accompanimentPath: draft.accompanimentPath,
    };
    transcribeRef.current = {
      words: draft.words,
      language: draft.language,
      pauses: draft.pauses ?? [],
      vocalsPath: draft.vocalsPath,
      accompanimentPath: draft.accompanimentPath,
    };

    setAudioUrl(`/api/audio?mp3=${encodeURIComponent(draft.mp3)}`);
    setVideoUrl(draft.videoPath ? `/api/video?path=${encodeURIComponent(draft.videoPath)}` : null);

    const ar: AlignResult = { notes: draft.notes, bpm: draft.bpm, gap: draft.gap };
    setAlignResult(ar);
    setTranscribed(true);
    setHasUploadedAudio(true);
    setCurrentDraftId(id);
    setDownloadUrl(null);
    setEditorOpen(false);
    setReprocessOpen(false);
    setNewFormOpen(false);
    setError(null);
    setPhase("idle");
    setPendingAudioFile(null);
    setPendingVideoFile(null);
  }, []);

  // ── Import from Ultrastar .txt ───────────────────────────────────────────
  const handleImportTxt = useCallback(async (txtFile: File, mp3File: File, videoFile: File | null) => {
    const fd = new FormData();
    fd.append("txt", txtFile);
    fd.append("mp3", mp3File);
    if (videoFile) fd.append("video", videoFile);
    const res = await fetch("/api/import", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Import failed" }));
      setError(err.message);
      return;
    }
    const { id } = await res.json();
    setDraftsRefreshKey((k) => k + 1);
    await handleLoadDraft(id);
  }, [handleLoadDraft]);

  // ── File selection ───────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    setPendingAudioFile(file);
    setFilename(file.name);
    uploadRef.current = null;
    transcribeRef.current = null;
    setTranscribed(false);
    setHasUploadedAudio(false);
    setDownloadUrl(null);
    setEditorOpen(false);
    setAlignResult(null);
    setAudioUrl(null);
    setVideoUrl(null);
    setError(null);
    setCurrentStage("");
  }, []);

  const handleVideoFile = useCallback((file: File) => {
    setPendingVideoFile(file);
    setVideoFilename(file.name);
  }, []);

  // ── Procesar ─────────────────────────────────────────────────────────────
  const handleProcess = useCallback(async () => {
    if (!pendingAudioFile && !uploadRef.current) return;
    setError(null);
    setDownloadUrl(null);
    setEditorOpen(false);
    setAlignResult(null);
    setTranscribed(false);
    transcribeRef.current = null;

    try {
      // 1 — upload (skip if audio already on server from a draft/prior upload)
      if (pendingAudioFile) {
        setPhase("uploading");
        setCurrentStage("Subiendo archivo…");
        uploadRef.current = null;
        const fd = new FormData();
        fd.append("file", pendingAudioFile);
        if (pendingVideoFile) fd.append("video", pendingVideoFile);
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        if (!upRes.ok) throw new Error((await upRes.json()).message);
        uploadRef.current = await upRes.json();
        setHasUploadedAudio(true);
      }

      // 2 — transcribe via SSE stream
      setPhase("transcribing");
      setCurrentStage("Conectando…");
      if (!uploadRef.current) throw new Error("No hay audio para procesar");

      // Short timeout only for the initial connection — once the stream starts
      // we clear it so it never cancels an in-progress transcription.
      const connectAbort = new AbortController();
      const connectTimeout = setTimeout(() => connectAbort.abort(), 60 * 1000);

      let trRes: Response;
      try {
        trRes = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mp3: uploadRef.current!.mp3, lyrics }),
          signal: connectAbort.signal,
        });
      } catch (fetchErr) {
        clearTimeout(connectTimeout);
        const isAbort = fetchErr instanceof DOMException && fetchErr.name === "AbortError";
        throw new Error(isAbort ? "El servicio no respondió en 60 s — ¿está corriendo Python?" : "No se pudo conectar al servicio de transcripción");
      }
      clearTimeout(connectTimeout); // connected — release the abort signal

      if (!trRes.ok) throw new Error((await trRes.json()).message);

      // Read SSE events — no timeout here; Python sends keepalive pings every 25 s
      const reader = trRes.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let result: TranscribeResult | null = null;

      outer: while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          throw new Error("Se cortó la conexión con el servicio durante el procesamiento");
        }
        if (chunk.done) break;

        buf += decoder.decode(chunk.value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let data: Record<string, unknown>;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }
          if (data.stage) setCurrentStage(data.stage as string);
          if (data.error) throw new Error(data.error as string);
          if (data.done) { result = data as unknown as TranscribeResult; break outer; }
        }
      }

      if (!result) throw new Error("El servicio no devolvió resultado");

      transcribeRef.current = result;
      if (result.vocalsPath) uploadRef.current!.vocalsPath = result.vocalsPath;
      if (result.accompanimentPath) uploadRef.current!.accompanimentPath = result.accompanimentPath;

      setCurrentStage("Alineando letra...");
      const alignRes = await fetch("/api/align", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mp3: uploadRef.current!.mp3,
          words: result.words,
          language: result.language,
          lyrics,
          pauses: result.pauses,
        }),
      });
      if (!alignRes.ok) throw new Error((await alignRes.json()).message);
      setAlignResult(await alignRes.json());

      setAudioUrl(`/api/audio?mp3=${encodeURIComponent(uploadRef.current!.mp3)}`);
      if (uploadRef.current!.videoPath) {
        setVideoUrl(`/api/video?path=${encodeURIComponent(uploadRef.current!.videoPath)}`);
      }

      setCurrentStage("Listo");
      setTranscribed(true);
      setReprocessOpen(false);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falló el procesamiento");
      setPhase("error");
    }
  }, [pendingAudioFile, pendingVideoFile, lyrics]);

  // ── Quick generate ───────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!uploadRef.current || !transcribeRef.current) return;
    setPhase("generating");
    setError(null);
    if (prevDownloadUrl.current) { URL.revokeObjectURL(prevDownloadUrl.current); prevDownloadUrl.current = null; }

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mp3: uploadRef.current.mp3,
          words: transcribeRef.current.words,
          language: transcribeRef.current.language,
          lyrics, title, artist,
          pauses: transcribeRef.current.pauses,
          videoPath: uploadRef.current.videoPath,
          vocalsPath: uploadRef.current.vocalsPath,
          accompanimentPath: uploadRef.current.accompanimentPath,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const url = URL.createObjectURL(await res.blob());
      prevDownloadUrl.current = url;
      setDownloadUrl(url);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falló la generación");
      setPhase("error");
    }
  }, [lyrics, title, artist]);

  // ── Open timeline editor ─────────────────────────────────────────────────
  const handleOpenEditor = useCallback(async () => {
    if (!uploadRef.current || !transcribeRef.current) return;
    // If we already have an alignment (e.g. loaded from draft), use it directly
    if (alignResult) { setEditorOpen(true); return; }
    setAligning(true);
    setError(null);
    try {
      const res = await fetch("/api/align", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mp3: uploadRef.current.mp3,
          words: transcribeRef.current.words,
          language: transcribeRef.current.language,
          lyrics,
          pauses: transcribeRef.current.pauses,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      setAlignResult(await res.json());
      setEditorOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falló el alineado");
    } finally {
      setAligning(false);
    }
  }, [lyrics, alignResult]);

  // ── Export from editor ───────────────────────────────────────────────────
  const handleEditorExport = useCallback(async (notes: EditorNote[], bpm: number, gap: number) => {
    if (!uploadRef.current) return;
    setPhase("generating");
    setError(null);
    if (prevDownloadUrl.current) { URL.revokeObjectURL(prevDownloadUrl.current); prevDownloadUrl.current = null; }

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mp3: uploadRef.current.mp3, editedNotes: notes, bpm, gap, title, artist,
          videoPath: uploadRef.current.videoPath,
          vocalsPath: uploadRef.current.vocalsPath,
          accompanimentPath: uploadRef.current.accompanimentPath,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const url = URL.createObjectURL(await res.blob());
      prevDownloadUrl.current = url;
      setDownloadUrl(url);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falló la generación");
      setPhase("error");
    }
  }, [title, artist]);

  // ── Render ───────────────────────────────────────────────────────────────

  // Full-screen editor mode — hides everything else
  if (editorOpen && alignResult && audioUrl) {
    return (
      <div className="fixed inset-0 z-50 overflow-hidden bg-zinc-950">
        <TimelineEditor
          initialNotes={alignResult.notes}
          bpm={alignResult.bpm}
          gap={alignResult.gap}
          audioUrl={audioUrl}
          videoUrl={videoUrl ?? undefined}
          title={title}
          artist={artist}
          draftId={currentDraftId ?? undefined}
          onExport={handleEditorExport}
          onClose={() => setEditorOpen(false)}
        />
      </div>
    );
  }

  return (
    <>
    <div className="flex min-h-dvh">
      <DraftsSidebar
        onHome={() => {
          setTranscribed(false);
          setNewFormOpen(false);
          setAlignResult(null);
          setAudioUrl(null);
          setVideoUrl(null);
          setCurrentDraftId(null);
          setDownloadUrl(null);
          setEditorOpen(false);
          setError(null);
          setPhase("idle");
          uploadRef.current = null;
          transcribeRef.current = null;
        }}
        onLoad={handleLoadDraft}
        onImport={handleImportTxt}
        refreshKey={draftsRefreshKey}
        currentDraftId={currentDraftId}
      />
    {/* Left padding matches sidebar width (w-64=16rem open, w-10=2.5rem closed) */}
    <div className="flex flex-1 flex-col min-w-0 pl-64">
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">

      {/* ── MODE A: no song yet ── */}
      {!transcribed && !newFormOpen && (
        <div className="flex flex-col items-center justify-center gap-8 py-16">
          <img src="/ultrasong.png" alt="Ultrasong" className="w-80 object-contain drop-shadow-md" />
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              Generá archivos Ultrastar Deluxe desde audio + letra
            </p>
          </div>
          <button
            onClick={() => {
              setTitle("");
              setArtist("");
              setLyrics("");
              setFilename("");
              setVideoFilename("");
              setPendingAudioFile(null);
              setPendingVideoFile(null);
              setError(null);
              uploadRef.current = null;
              transcribeRef.current = null;
              setHasUploadedAudio(false);
              setNewFormOpen(true);
            }}
            className="flex items-center gap-2 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Nueva canción
          </button>
        </div>
      )}

      {/* ── MODE A: new song form ── */}
      {!transcribed && newFormOpen && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setNewFormOpen(false)}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Volver
            </button>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Nueva canción</h2>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Audio</h3>
            <FileUpload onFile={handleFile} disabled={busy} filename={filename || undefined} />
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              <span className="text-xs text-zinc-400">+ video opcional (sin audio)</span>
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
            </div>
            <FileUpload
              onFile={handleVideoFile}
              disabled={busy}
              filename={videoFilename || undefined}
              accept="video"
              label="Drop video file here (optional)"
              sublabel="mp4, mkv, webm, mov — used as background in Ultrastar"
            />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Info &amp; letra</h3>
            <LyricsInput
              title={title} artist={artist} lyrics={lyrics}
              onTitle={setTitle} onArtist={setArtist} onLyrics={setLyrics}
              disabled={busy}
            />
          </div>

          <button
            onClick={handleProcess}
            disabled={!canProcess}
            className="flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy ? <><Spinner />{phase === "uploading" ? "Subiendo…" : "Procesando…"}</> : "Procesar"}
          </button>

          {(phase === "uploading" || phase === "transcribing") && currentStage && (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/50">
              <Spinner />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{currentStage}</span>
                {phase === "transcribing" && transcribeElapsed > 0 && (
                  <span className="text-[10px] text-zinc-400">{fmtTime(transcribeElapsed)} transcurrido</span>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </section>
      )}

      {/* ── MODE B: song ready — info card + actions ── */}
      {transcribed && (
        <section className="flex flex-col gap-3">
          {/* Song info card */}
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
            <div>
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{artist}</p>
            </div>

            {videoUrl && (
              <video
                ref={infoVideoRef}
                src={videoUrl}
                muted
                className="w-full rounded-lg"
                style={{ maxHeight: "240px" }}
              />
            )}

            {audioUrl && (
              <audio ref={infoAudioRef} src={audioUrl} controls className="w-full" />
            )}

            {lyrics && (
              <pre className="max-h-48 overflow-y-auto rounded-lg bg-zinc-50 px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">
                {lyrics}
              </pre>
            )}
          </div>

          {/* Primary actions */}
          <div className="grid grid-cols-2 gap-2">
            <GenerateButton phase={phase} onClick={handleGenerate} disabled={!canAct} />
            <button
              onClick={handleOpenEditor}
              disabled={!canAct || aligning}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {aligning ? <Spinner /> : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              )}
              Editar Timeline
            </button>
          </div>

          <DownloadPanel url={downloadUrl} title={title} error={error} />

          {/* Re-process expander */}
          <button
            onClick={() => setReprocessOpen((v) => !v)}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <svg className={`h-4 w-4 transition-transform ${reprocessOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            Modificar / Re-procesar
          </button>

          {/* Collapsible re-process form */}
          {reprocessOpen && (
            <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Audio</h3>
                <FileUpload onFile={handleFile} disabled={busy} filename={filename || undefined} />
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                  <span className="text-xs text-zinc-400">+ video opcional (sin audio)</span>
                  <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                </div>
                <FileUpload
                  onFile={handleVideoFile}
                  disabled={busy}
                  filename={videoFilename || undefined}
                  accept="video"
                  label="Drop video file here (optional)"
                  sublabel="mp4, mkv, webm, mov — used as background in Ultrastar"
                />
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Info &amp; letra</h3>
                <LyricsInput
                  title={title} artist={artist} lyrics={lyrics}
                  onTitle={setTitle} onArtist={setArtist} onLyrics={setLyrics}
                  disabled={busy}
                />
              </div>

              <button
                onClick={handleSaveDraft}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                {saving ? <Spinner /> : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                )}
                {currentDraftId ? "Actualizar borrador" : "Guardar borrador"}
              </button>

              <button
                onClick={handleProcess}
                disabled={!canProcess}
                className="flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {busy ? <><Spinner />{phase === "uploading" ? "Subiendo…" : "Procesando…"}</> : "Re-procesar"}
              </button>

              {(phase === "uploading" || phase === "transcribing") && currentStage && (
                <div className="flex items-center gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                  <Spinner />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{currentStage}</span>
                    {phase === "transcribing" && transcribeElapsed > 0 && (
                      <span className="text-[10px] text-zinc-400">{fmtTime(transcribeElapsed)} transcurrido</span>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>

    </div>
    </div>
    </>
  );
}
