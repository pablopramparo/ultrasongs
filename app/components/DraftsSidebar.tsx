"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { useI18n } from "@/app/i18n/I18nProvider";

interface DraftMeta {
  id: string;
  title: string;
  artist: string;
  savedAt: string;
  hasVideo: boolean;
}

interface LibrarySong {
  folder: string;
  title: string;
  artist: string;
  hasVideo: boolean;
  ours: boolean;
}

interface Props {
  onHome: () => void;
  onOpenSettings: () => void;
  /** Called with the new draft id after a song from the Songs folder was imported. */
  onLibraryImport: (id: string) => void;
  onLoad: (id: string) => void;
  onImport: (txt: File, mp3: File, video: File | null) => void;
  refreshKey: number;
  currentDraftId: string | null;
}

function fmt(iso: string, locale: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(locale, { day: "2-digit", month: "short" }) +
    " " +
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  );
}

export default function DraftsSidebar({
  onHome,
  onOpenSettings,
  onLibraryImport,
  onLoad,
  onImport,
  refreshKey,
  currentDraftId,
}: Props) {
  const { t, locale } = useI18n();
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibrarySong[]>([]);
  const [libraryConfigured, setLibraryConfigured] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Asking before a bulk write: `dir` is the folder it would write to (null = not configured yet)
  const [confirmAll, setConfirmAll] = useState<{ dir: string | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importTxt, setImportTxt] = useState<File | null>(null);
  const [importMp3, setImportMp3] = useState<File | null>(null);
  const [importVideo, setImportVideo] = useState<File | null>(null);
  const txtRef = useRef<HTMLInputElement>(null);
  const mp3Ref = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/drafts");
        if (res.ok && !cancelled) setDrafts(await res.json());
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/library");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setLibraryConfigured(data.configured);
        setLibrary(data.songs);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const handleLibraryImport = async (song: LibrarySong) => {
    setLibraryBusy(song.folder);
    setLibraryError(null);
    try {
      const res = await fetch("/api/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: song.folder }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      onLibraryImport(data.id);
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : t("error.importFailed"));
    } finally {
      setLibraryBusy(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleting(id);
    try {
      await fetch(`/api/drafts/${id}`, { method: "DELETE" });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  /** Writes one draft into SONGS_DIR. Returns an error message, or null on success. */
  const exportDraft = async (id: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/drafts/${id}/export`, { method: "POST" });
      const data = await res.json();
      return res.ok ? null : (data.message as string);
    } catch {
      return t("sidebar.serverUnreachable");
    }
  };

  const handleExport = async (e: React.MouseEvent, d: DraftMeta) => {
    e.stopPropagation();
    setExporting(d.id);
    setExportMsg(null);
    const err = await exportDraft(d.id);
    setExportMsg(err ? { ok: false, text: `${d.title}: ${err}` } : { ok: true, text: t("sidebar.savedOne", { title: d.title }) });
    setExporting(null);
  };

  /** First step of "save all": show where everything would be written and ask. */
  const askExportAll = async () => {
    setExportMsg(null);
    try {
      const res = await fetch("/api/settings");
      const s = await res.json();
      setConfirmAll({ dir: s.songsDir ?? null });
    } catch {
      setConfirmAll({ dir: null });
    }
  };

  /** Second step, only reached from the confirmation panel. */
  const handleExportAll = async () => {
    setConfirmAll(null);
    setExporting("all");
    setExportMsg(null);
    let okCount = 0;
    const failures: string[] = [];
    for (const d of drafts) {
      const err = await exportDraft(d.id);
      if (err) failures.push(`${d.title}: ${err}`);
      else okCount++;
    }
    setExportMsg({
      ok: failures.length === 0,
      text: t("sidebar.savedMany", { n: okCount }) + (failures.length ? `. ${failures.join(" · ")}` : ""),
    });
    setExporting(null);
  };

  const handleImportSubmit = async () => {
    if (!importTxt || !importMp3) return;
    setImporting(true);
    try {
      await onImport(importTxt, importMp3, importVideo);
      setShowImport(false);
      setImportTxt(null);
      setImportMp3(null);
      setImportVideo(null);
      if (txtRef.current) txtRef.current.value = "";
      if (mp3Ref.current) mp3Ref.current.value = "";
      if (vidRef.current) vidRef.current.value = "";
    } finally {
      setImporting(false);
    }
  };

  const footerBtn =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40";
  const fileInput =
    "mt-1 block w-full text-xs text-zinc-400 file:mr-2 file:rounded-md file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:font-medium file:text-zinc-200 hover:file:bg-zinc-700";

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-64 flex-col border-r border-zinc-800 bg-zinc-900">
      {/* Logo → home */}
      <button
        onClick={onHome}
        title={t("sidebar.goHome")}
        className="flex h-28 w-full shrink-0 items-center justify-center border-b border-zinc-800 transition-colors hover:bg-zinc-800/60"
      >
        <Image src="/ultrasong.png" alt="Ultrasongs" width={132} height={86} className="object-contain" priority unoptimized />
      </button>

      {/* Drafts */}
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="section-label">{t("sidebar.drafts")}</span>
        {drafts.length > 0 && <span className="text-xs text-zinc-500">{drafts.length}</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
        {drafts.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-zinc-500">{t("sidebar.noDrafts")}</p>
        )}
        {drafts.map((d) => (
          <div
            key={d.id}
            role="button"
            tabIndex={0}
            onClick={() => onLoad(d.id)}
            onKeyDown={(e) => e.key === "Enter" && onLoad(d.id)}
            className={`group relative flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
              d.id === currentDraftId
                ? "bg-blue-600/15 ring-1 ring-inset ring-blue-500/50"
                : "hover:bg-zinc-800"
            }`}
          >
            <span className="truncate pr-12 text-sm font-semibold text-zinc-100">{d.title || t("sidebar.untitled")}</span>
            <span className="truncate text-xs text-zinc-400">{d.artist || "—"}</span>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-zinc-500">{fmt(d.savedAt, locale)}</span>
              {d.hasVideo && (
                <span className="rounded bg-zinc-800 px-1.5 py-px text-[11px] font-medium text-zinc-400 group-hover:bg-zinc-700">
                  {t("sidebar.video")}
                </span>
              )}
            </div>

            {/* Export to Songs button */}
            <button
              onClick={(e) => handleExport(e, d)}
              disabled={exporting !== null}
              title={t("sidebar.exportDraft")}
              className="absolute right-9 top-2.5 hidden rounded-md p-1 text-zinc-500 hover:bg-green-950 hover:text-green-400 group-hover:flex"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            </button>

            {/* Delete button */}
            <button
              onClick={(e) => handleDelete(e, d.id)}
              disabled={deleting === d.id}
              title={t("sidebar.deleteDraft")}
              className="absolute right-2 top-2.5 hidden rounded-md p-1 text-zinc-500 hover:bg-red-950 hover:text-red-400 group-hover:flex"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Library and tools, pinned to the bottom */}
      <div className="max-h-[55%] shrink-0 overflow-y-auto border-t border-zinc-800">
        {/* Settings */}
        <div className="px-3 py-2">
          <button onClick={onOpenSettings} className={footerBtn}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {t("sidebar.settings")}
          </button>
        </div>

        {/* Songs library */}
        {libraryConfigured && (
          <div className="border-t border-zinc-800 px-3 py-2">
            <button
              onClick={() => setLibraryOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <span>{t("sidebar.inSongs", { n: library.length })}</span>
              <svg
                className={`h-3.5 w-3.5 transition-transform ${libraryOpen ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {libraryOpen && (
              <div className="mt-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                {libraryError && <p className="px-2 text-xs text-red-400">{libraryError}</p>}
                {library.length === 0 && <p className="px-2 py-2 text-center text-xs text-zinc-500">{t("sidebar.noSongs")}</p>}
                {library.map((song) => (
                  <button
                    key={song.folder}
                    onClick={() => handleLibraryImport(song)}
                    disabled={libraryBusy !== null}
                    title={t("sidebar.importAsDraft")}
                    className="flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-zinc-200">{song.title}</span>
                      {song.ours && (
                        <span title={t("sidebar.createdHere")} className="text-xs text-green-400">✓</span>
                      )}
                      {libraryBusy === song.folder && <span className="text-[11px] text-zinc-500">{t("sidebar.importingSong")}</span>}
                    </span>
                    <span className="truncate text-xs text-zinc-500">{song.artist || "—"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Save drafts to the Songs folder (single drafts have their own icon) */}
        {drafts.length > 0 && (
          <div className="border-t border-zinc-800 px-3 py-2">
            {!confirmAll ? (
              <button
                onClick={askExportAll}
                disabled={exporting !== null}
                title={t("sidebar.saveAllTitle")}
                className={footerBtn}
              >
                {exporting === "all" ? t("sidebar.saving") : t("sidebar.saveAll")}
              </button>
            ) : confirmAll.dir ? (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-900/70 bg-amber-950/30 p-3 text-xs">
                <p className="text-amber-200">{t("sidebar.confirmSaveAll", { n: drafts.length })}</p>
                <p className="break-all rounded-md bg-zinc-950 px-2 py-1.5 font-mono text-zinc-300">{confirmAll.dir}</p>
                <p className="text-zinc-400">{t("sidebar.confirmSaveAllNote")}</p>
                <div className="mt-1 flex items-center gap-2">
                  <button onClick={handleExportAll} className="btn btn-primary !px-3 !py-1.5 text-xs">
                    {t("sidebar.confirmYes")}
                  </button>
                  <button onClick={() => setConfirmAll(null)} className="px-2 text-xs text-zinc-400 hover:text-zinc-100">
                    {t("action.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
                <p className="text-zinc-300">{t("api.pickSongsFirst")}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setConfirmAll(null); onOpenSettings(); }}
                    className="btn btn-secondary !px-3 !py-1.5 text-xs"
                  >
                    {t("sidebar.settings")}
                  </button>
                  <button onClick={() => setConfirmAll(null)} className="px-2 text-xs text-zinc-400 hover:text-zinc-100">
                    {t("action.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {exportMsg && (
          <p className={`border-t border-zinc-800 px-5 py-2 text-xs ${exportMsg.ok ? "text-green-400" : "text-red-400"}`}>
            {exportMsg.text}
          </p>
        )}

        {/* Import section */}
        <div className="border-t border-zinc-800 px-3 py-2">
          <button onClick={() => setShowImport((v) => !v)} className={footerBtn}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {t("sidebar.importTxt")}
          </button>
          {showImport && (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <label className="text-xs text-zinc-400">
                {t("sidebar.fileTxt")}
                <input ref={txtRef} type="file" accept=".txt" className={fileInput}
                  onChange={(e) => setImportTxt(e.target.files?.[0] ?? null)} />
              </label>
              <label className="text-xs text-zinc-400">
                {t("sidebar.fileMp3")}
                <input ref={mp3Ref} type="file" accept="audio/*" className={fileInput}
                  onChange={(e) => setImportMp3(e.target.files?.[0] ?? null)} />
              </label>
              <label className="text-xs text-zinc-400">
                {t("sidebar.fileVideo")}
                <input ref={vidRef} type="file" accept="video/*" className={fileInput}
                  onChange={(e) => setImportVideo(e.target.files?.[0] ?? null)} />
              </label>
              <button
                onClick={handleImportSubmit}
                disabled={!importTxt || !importMp3 || importing}
                className="btn btn-primary w-full !py-2 text-xs"
              >
                {importing ? t("sidebar.importing") : t("sidebar.import")}
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
