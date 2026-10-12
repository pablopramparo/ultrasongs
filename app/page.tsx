"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import SourceSelector from "./components/SourceSelector";
import SetupScreen from "./components/SetupScreen";
import SettingsPanel from "./components/SettingsPanel";
import MediaPlayer from "./components/MediaPlayer";
import Modal from "./components/Modal";
import { useI18n } from "./i18n/I18nProvider";
import type { MessageKey } from "./i18n";
import type { YoutubeResult } from "./components/YoutubeInput";
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
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [transcribed, setTranscribed] = useState(false);
  const [currentStage, setCurrentStage] = useState("");
  const [transcribeElapsed, setTranscribeElapsed] = useState(0);

  const [editorOpen, setEditorOpen] = useState(false);
  const [alignResult, setAlignResult] = useState<AlignResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);

  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  // First run: the Python environment and models are installed from here when missing.
  const [setupStatus, setSetupStatus] = useState<{ ready: boolean; home: string; cuda: boolean; gpuName: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((s) => { if (!cancelled) setSetupStatus(s); })
      .catch(() => { /* status unavailable: assume ready, errors surface later */ });
    return () => { cancelled = true; };
  }, []);
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  // true when audio is already on the server (from a saved draft or prior upload)
  const [hasUploadedAudio, setHasUploadedAudio] = useState(false);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [newFormOpen, setNewFormOpen] = useState(false);

  const uploadRef = useRef<UploadResult | null>(null);
  const transcribeRef = useRef<TranscribeResult | null>(null);
  const prevDownloadUrl = useRef<string | null>(null);

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
  // The timeline editor works on existing notes: imported songs have no lyrics text and still open.
  const canEdit = transcribed && !busy && (!!alignResult || !!lyrics.trim());

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ── Persist a draft ──────────────────────────────────────────────────────
  // Shared by the manual "Guardar borrador" button and the automatic save after processing.
  const persistDraft = useCallback(
    async (ar: AlignResult, tr: TranscribeResult, up: UploadResult, draftId: string | null): Promise<string | null> => {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draftId ?? undefined,
          title, artist, lyrics,
          bpm: ar.bpm, gap: ar.gap, notes: ar.notes,
          words: tr.words,
          language: tr.language,
          pauses: tr.pauses ?? [],
          mp3: up.mp3,
          videoPath: up.videoPath,
          vocalsPath: up.vocalsPath,
          accompanimentPath: up.accompanimentPath,
        }),
      });
      if (!res.ok) return null;
      const { id } = await res.json();
      setCurrentDraftId(id);
      setDraftsRefreshKey((k) => k + 1);
      return id as string;
    },
    [title, artist, lyrics]
  );

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

      await persistDraft(ar, transcribeRef.current, uploadRef.current, currentDraftId);
    } finally {
      setSaving(false);
    }
  }, [alignResult, lyrics, currentDraftId, persistDraft]);

  // ── Load draft ───────────────────────────────────────────────────────────
  const handleLoadDraft = useCallback(async (id: string) => {
    const res = await fetch(`/api/drafts/${id}`);
    if (!res.ok) return false;
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
    return true;
  }, []);

  // ── Import from Ultrastar .txt ───────────────────────────────────────────
  const handleImportTxt = useCallback(async (txtFile: File, mp3File: File, videoFile: File | null) => {
    const fd = new FormData();
    fd.append("txt", txtFile);
    fd.append("mp3", mp3File);
    if (videoFile) fd.append("video", videoFile);
    const res = await fetch("/api/import", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: t("error.importFailed") }));
      setError(err.message);
      return;
    }
    const { id } = await res.json();
    setDraftsRefreshKey((k) => k + 1);
    await handleLoadDraft(id);
  }, [handleLoadDraft, t]);

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

  // Audio + video already on the server (downloaded from YouTube): no upload step needed.
  const handleYoutube = useCallback((r: YoutubeResult) => {
    setPendingAudioFile(null);
    setPendingVideoFile(null);
    setFilename(r.title || "YouTube");
    setVideoFilename(r.title || "YouTube");
    uploadRef.current = { id: r.id, mp3: r.mp3, videoPath: r.videoPath };
    transcribeRef.current = null;
    setHasUploadedAudio(true);
    setTranscribed(false);
    setDownloadUrl(null);
    setEditorOpen(false);
    setAlignResult(null);
    setAudioUrl(null);
    setVideoUrl(null);
    setError(null);
    setCurrentStage("");
    setTitle((prev) => prev || r.title);
  }, []);

  // ── Procesar ─────────────────────────────────────────────────────────────
  const handleProcess = useCallback(async () => {
    if (!pendingAudioFile && !uploadRef.current) return;
    setError(null);
    setDownloadUrl(null);
    setEditorOpen(false);
    setAlignResult(null);
    setTranscribed(false);
    // Keep the form on screen while processing: with transcribed=false and the form closed
    // (the case when re-processing a loaded draft) the page would fall back to the home screen.
    setNewFormOpen(true);
    transcribeRef.current = null;

    try {
      // 1 — upload (skip if audio already on server from a draft/prior upload)
      if (pendingAudioFile) {
        setPhase("uploading");
        setCurrentStage(t("stage.uploadingFile"));
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
      setCurrentStage(t("stage.connecting"));
      if (!uploadRef.current) throw new Error(t("error.noAudio"));

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
        throw new Error(isAbort ? t("error.serviceTimeout") : t("error.serviceConnect"));
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
          throw new Error(t("error.streamCut"));
        }
        if (chunk.done) break;

        buf += decoder.decode(chunk.value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let data: Record<string, unknown>;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }
          if (data.stage) setCurrentStage(data.stageKey ? t(data.stageKey as MessageKey) : (data.stage as string));
          if (data.error) throw new Error(data.error as string);
          if (data.done) { result = data as unknown as TranscribeResult; break outer; }
        }
      }

      if (!result) throw new Error(t("error.noResult"));

      transcribeRef.current = result;
      if (result.vocalsPath) uploadRef.current!.vocalsPath = result.vocalsPath;
      if (result.accompanimentPath) uploadRef.current!.accompanimentPath = result.accompanimentPath;

      setCurrentStage(t("stage.aligning"));
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
      const aligned: AlignResult = await alignRes.json();
      setAlignResult(aligned);

      // A new song is saved as a draft right away: processing takes minutes and the result would
      // otherwise be lost on closing the app. Re-processing an existing draft is not saved silently,
      // since that would overwrite notes the user may have edited ("Actualizar borrador" does it).
      if (!currentDraftId) {
        try {
          await persistDraft(aligned, result, uploadRef.current!, null);
        } catch {
          /* the draft can still be saved by hand */
        }
      }

      setAudioUrl(`/api/audio?mp3=${encodeURIComponent(uploadRef.current!.mp3)}`);
      if (uploadRef.current!.videoPath) {
        setVideoUrl(`/api/video?path=${encodeURIComponent(uploadRef.current!.videoPath)}`);
      }

      setCurrentStage(t("stage.done"));
      setTranscribed(true);
      setReprocessOpen(false);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.processFailed"));
      setPhase("error");
    }
  }, [pendingAudioFile, pendingVideoFile, lyrics, currentDraftId, persistDraft, t]);

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
      const saved = res.headers.get("X-Saved-To");
      const saveErr = res.headers.get("X-Save-Error");
      setSavedTo(saved ? decodeURIComponent(saved) : null);
      setSaveError(saveErr ? decodeURIComponent(saveErr) : null);
      const url = URL.createObjectURL(await res.blob());
      prevDownloadUrl.current = url;
      setDownloadUrl(url);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generateFailed"));
      setPhase("error");
    }
  }, [lyrics, title, artist, t]);

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
      setError(err instanceof Error ? err.message : t("error.alignFailed"));
    } finally {
      setAligning(false);
    }
  }, [lyrics, alignResult, t]);

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
          draftId: currentDraftId ?? undefined,
          videoPath: uploadRef.current.videoPath,
          vocalsPath: uploadRef.current.vocalsPath,
          accompanimentPath: uploadRef.current.accompanimentPath,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const saved = res.headers.get("X-Saved-To");
      const saveErr = res.headers.get("X-Save-Error");
      setSavedTo(saved ? decodeURIComponent(saved) : null);
      setSaveError(saveErr ? decodeURIComponent(saveErr) : null);
      const url = URL.createObjectURL(await res.blob());
      prevDownloadUrl.current = url;
      setDownloadUrl(url);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generateFailed"));
      setPhase("error");
    }
  }, [title, artist, currentDraftId, t]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (setupStatus && !setupStatus.ready) {
    return (
      <SetupScreen
        status={setupStatus}
        onDone={() => setSetupStatus({ ...setupStatus, ready: true })}
      />
    );
  }

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
          exportStatus={{
            busy: phase === "generating",
            url: downloadUrl,
            filename: `${title || "song"}.zip`,
            savedTo,
            saveError,
            error: phase === "error" ? error : null,
          }}
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
          setSettingsOpen(false);
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
        onOpenSettings={() => setSettingsOpen(true)}
        onLoad={(id) => {
          setSettingsOpen(false);
          return handleLoadDraft(id);
        }}
        onLibraryImport={async (id) => {
          setSettingsOpen(false);
          setDraftsRefreshKey((k) => k + 1);
          await handleLoadDraft(id);
        }}
        onImport={handleImportTxt}
        refreshKey={draftsRefreshKey}
        currentDraftId={currentDraftId}
      />
    {/* Left padding matches sidebar width (w-64=16rem open, w-10=2.5rem closed) */}
    <div className="flex flex-1 flex-col min-w-0 pl-64">
    <div className={`mx-auto flex w-full flex-col gap-6 px-4 py-12 ${transcribed && !settingsOpen ? "max-w-5xl" : "max-w-2xl"}`}>

      {settingsOpen && (
        <SettingsPanel
          onBack={() => setSettingsOpen(false)}
          onSongsFolderChanged={() => setDraftsRefreshKey((k) => k + 1)}
        />
      )}

      {/* ── MODE A: no song yet ── */}
      {!settingsOpen && !transcribed && !newFormOpen && (
        <div className="flex flex-col items-center justify-center gap-8 py-16">
          <img src="/ultrasong.png" alt="Ultrasongs" className="w-96 max-w-full object-contain drop-shadow-md" />
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              {t("app.tagline")}
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
            className="btn btn-primary px-6 py-3"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t("action.newSong")}
          </button>
        </div>
      )}

      {/* ── MODE A: new song form ── */}
      {!settingsOpen && !transcribed && newFormOpen && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setNewFormOpen(false)}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              {t("action.back")}
            </button>
            <h2 className="text-sm font-semibold text-zinc-100">{t("newSong.title")}</h2>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="section-label">{t("section.audio")}</h3>
            <SourceSelector
              onFile={handleFile}
              onVideoFile={handleVideoFile}
              onYoutube={handleYoutube}
              disabled={busy}
              filename={filename || undefined}
              videoFilename={videoFilename || undefined}
            />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="section-label">{t("section.infoLyrics")}</h3>
            <LyricsInput
              title={title} artist={artist} lyrics={lyrics}
              onTitle={setTitle} onArtist={setArtist} onLyrics={setLyrics}
              disabled={busy}
            />
          </div>

          <button
            onClick={handleProcess}
            disabled={!canProcess}
            className="btn btn-primary w-full py-3"
          >
            {busy ? <><Spinner />{phase === "uploading" ? t("process.uploading") : t("process.processing")}</> : t("process.start")}
          </button>

          {(phase === "uploading" || phase === "transcribing") && currentStage && (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5">
              <Spinner />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{currentStage}</span>
                {phase === "transcribing" && transcribeElapsed > 0 && (
                  <span className="text-[10px] text-zinc-400">{t("process.elapsed", { time: fmtTime(transcribeElapsed) })}</span>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </section>
      )}

      {/* ── MODE B: song ready ── */}
      {!settingsOpen && transcribed && (
        <section className="flex flex-col gap-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{title}</h1>
            <p className="text-sm text-zinc-400">{artist}</p>
          </div>

          {/* Player and lyrics side by side on wide windows, stacked on narrow ones */}
          <div className={`grid items-start gap-4 ${lyrics && audioUrl ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}>
            {audioUrl && (
              <div className="card p-4">
                <MediaPlayer key={audioUrl} audioUrl={audioUrl} videoUrl={videoUrl} />
              </div>
            )}
            {lyrics && (
              // Taller than the player so more lines fit without scrolling; it follows the window height up to a cap
              <div className="card flex flex-col p-4 lg:h-[clamp(20rem,calc(100dvh-16rem),40rem)]">
                <h3 className="section-label mb-3 shrink-0">{t("song.lyrics")}</h3>
                <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-zinc-300 lg:min-h-0 lg:max-h-none lg:flex-1">
                  {lyrics}
                </pre>
              </div>
            )}
          </div>

          {/* Primary actions */}
          <div className="grid gap-2 sm:grid-cols-3">
            <GenerateButton phase={phase} onClick={handleGenerate} disabled={!canAct} />
            <button
              onClick={handleOpenEditor}
              disabled={!canEdit || aligning}
              className="btn btn-secondary w-full"
            >
              {aligning ? <Spinner /> : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              )}
              {t("song.editTimeline")}
            </button>
            <button onClick={() => setReprocessOpen(true)} className="btn btn-dashed w-full font-medium">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {t("song.modify")}
            </button>
          </div>

          <DownloadPanel url={downloadUrl} title={title} error={error} savedTo={savedTo} saveError={saveError} />

          {/* Modify / re-process, in a dialog so the player and lyrics keep the whole page */}
          <Modal open={reprocessOpen} title={t("song.modify")} onClose={() => setReprocessOpen(false)}>
            <div className="flex flex-col gap-2">
              <h3 className="section-label">{t("section.audio")}</h3>
              <SourceSelector
                onFile={handleFile}
                onVideoFile={handleVideoFile}
                onYoutube={handleYoutube}
                disabled={busy}
                filename={filename || undefined}
                videoFilename={videoFilename || undefined}
              />
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="section-label">{t("section.infoLyrics")}</h3>
              <LyricsInput
                title={title} artist={artist} lyrics={lyrics}
                onTitle={setTitle} onArtist={setArtist} onLyrics={setLyrics}
                disabled={busy}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                onClick={handleSaveDraft}
                disabled={saving}
                className="btn btn-secondary w-full"
              >
                {saving ? <Spinner /> : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                )}
                {currentDraftId ? t("song.updateDraft") : t("song.saveDraft")}
              </button>

              <button
                onClick={handleProcess}
                disabled={!canProcess}
                className="btn btn-primary w-full"
              >
                {busy ? <><Spinner />{phase === "uploading" ? t("process.uploading") : t("process.processing")}</> : t("process.reprocess")}
              </button>
            </div>

            {(phase === "uploading" || phase === "transcribing") && currentStage && (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                <Spinner />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs font-medium text-zinc-200">{currentStage}</span>
                  {phase === "transcribing" && transcribeElapsed > 0 && (
                    <span className="text-xs text-zinc-500">{t("process.elapsed", { time: fmtTime(transcribeElapsed) })}</span>
                  )}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}
          </Modal>
        </section>
      )}
    </div>

    </div>
    </div>
    </>
  );
}
