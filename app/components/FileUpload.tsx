"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";

const AUDIO_ACCEPTED = ".mp3,.mp4,.mkv,.webm,.ogg,.flac,.wav,.m4a,.mov,.avi";
const VIDEO_ACCEPTED = ".mp4,.mkv,.webm,.mov,.avi";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
  filename?: string;
  accept?: "audio" | "video";
  label?: string;
  sublabel?: string;
}

export default function FileUpload({ onFile, disabled, filename, accept = "audio", label, sublabel }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const accepted = accept === "video" ? VIDEO_ACCEPTED : AUDIO_ACCEPTED;

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={[
        "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-sm transition-colors",
        disabled
          ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-600"
          : dragging
          ? "cursor-copy border-blue-400 bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
          : "cursor-pointer border-zinc-300 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-500",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accepted}
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
      <svg className="h-8 w-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
      {filename ? (
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{filename}</span>
      ) : (
        <>
          <span className="font-medium">{label ?? t("source.dropAudio")}</span>
          <span className="text-xs opacity-70">{sublabel ?? t("source.dropAudioHint")}</span>
        </>
      )}
    </div>
  );
}
