"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";

interface DraftMeta {
  id: string;
  title: string;
  artist: string;
  savedAt: string;
  hasVideo: boolean;
}

interface Props {
  onHome: () => void;
  onLoad: (id: string) => void;
  onImport: (txt: File, mp3: File, video: File | null) => void;
  refreshKey: number;
  currentDraftId: string | null;
}

function fmt(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

export default function DraftsSidebar({
  onHome,
  onLoad,
  onImport,
  refreshKey,
  currentDraftId,
}: Props) {
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
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

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-64 flex-col overflow-y-auto border-r border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
      {/* Logo → home */}
      <button
        onClick={onHome}
        title="Ir al inicio"
        className="flex h-26 w-full shrink-0 items-center border-b border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 mx-auto"
      >
        <Image
          src="/ultrasong.png"
          alt="Ultrasong"
          width={100}
          height={40}
          className="object-contain mx-auto"
        />
      </button>

      <>
        <div className="px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
            Borradores
          </span>
        </div>

        {/* Import section */}
        <div className="border-t border-zinc-200 px-2 py-2 dark:border-zinc-700">
          <button
            onClick={() => setShowImport((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-[10px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Importar .txt
          </button>
          {showImport && (
            <div className="mt-1.5 flex flex-col gap-1.5 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
              <label className="text-[10px] text-zinc-500">
                Archivo .txt *
                <input
                  ref={txtRef}
                  type="file"
                  accept=".txt"
                  className="mt-0.5 block w-full text-[10px] text-zinc-600 file:mr-1 file:rounded file:border-0 file:bg-zinc-100 file:px-1.5 file:py-0.5 file:text-[10px] dark:file:bg-zinc-700 dark:file:text-zinc-300"
                  onChange={(e) => setImportTxt(e.target.files?.[0] ?? null)}
                />
              </label>
              <label className="text-[10px] text-zinc-500">
                Archivo .mp3 *
                <input
                  ref={mp3Ref}
                  type="file"
                  accept="audio/*"
                  className="mt-0.5 block w-full text-[10px] text-zinc-600 file:mr-1 file:rounded file:border-0 file:bg-zinc-100 file:px-1.5 file:py-0.5 file:text-[10px] dark:file:bg-zinc-700 dark:file:text-zinc-300"
                  onChange={(e) => setImportMp3(e.target.files?.[0] ?? null)}
                />
              </label>
              <label className="text-[10px] text-zinc-500">
                Video (opcional)
                <input
                  ref={vidRef}
                  type="file"
                  accept="video/*"
                  className="mt-0.5 block w-full text-[10px] text-zinc-600 file:mr-1 file:rounded file:border-0 file:bg-zinc-100 file:px-1.5 file:py-0.5 file:text-[10px] dark:file:bg-zinc-700 dark:file:text-zinc-300"
                  onChange={(e) => setImportVideo(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                onClick={handleImportSubmit}
                disabled={!importTxt || !importMp3 || importing}
                className="mt-0.5 rounded bg-zinc-900 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {importing ? "Importando…" : "Importar"}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 overflow-y-auto px-2 pt-2 pb-4">
          {drafts.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-zinc-400">
              Sin borradores
            </p>
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
                  ? "bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-950 dark:ring-blue-700"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                {d.title || "Sin título"}
              </span>
              <span className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                {d.artist || "—"}
              </span>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-400">
                  {fmt(d.savedAt)}
                </span>
                {d.hasVideo && (
                  <span className="rounded bg-zinc-200 px-1 text-[9px] font-medium text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                    video
                  </span>
                )}
              </div>

              {/* Delete button */}
              <button
                onClick={(e) => handleDelete(e, d.id)}
                disabled={deleting === d.id}
                title="Eliminar borrador"
                className="absolute right-2 top-2 hidden rounded p-0.5 text-zinc-300 hover:bg-red-50 hover:text-red-500 group-hover:flex dark:text-zinc-600 dark:hover:bg-red-950 dark:hover:text-red-400"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </>
    </aside>
  );
}
