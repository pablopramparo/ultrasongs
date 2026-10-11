"use client";

import { useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";
import FileUpload from "./FileUpload";
import YoutubeInput, { type YoutubeResult } from "./YoutubeInput";
import { YOUTUBE_ENABLED } from "@/app/lib/features";

interface Props {
  onFile: (file: File) => void;
  onVideoFile: (file: File) => void;
  onYoutube: (result: YoutubeResult) => void;
  disabled?: boolean;
  filename?: string;
  videoFilename?: string;
}

type Mode = "youtube" | "manual";

const MODES = [
  { id: "youtube", labelKey: "source.youtube" },
  { id: "manual", labelKey: "source.manual" },
] as const;

export default function SourceSelector({ onFile, onVideoFile, onYoutube, disabled, filename, videoFilename }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>(YOUTUBE_ENABLED ? "youtube" : "manual");

  return (
    <div className="flex flex-col gap-3">
      {YOUTUBE_ENABLED && (
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-900 p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            disabled={disabled}
            className={[
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
              mode === m.id
                ? "bg-blue-600/15 text-blue-300 ring-1 ring-inset ring-blue-500/40"
                : "text-zinc-400 hover:text-zinc-100",
            ].join(" ")}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>
      )}

      {YOUTUBE_ENABLED && mode === "youtube" ? (
        <YoutubeInput onResult={onYoutube} disabled={disabled} loadedTitle={filename} />
      ) : (
        <div className="flex flex-col gap-2">
          <FileUpload onFile={onFile} disabled={disabled} filename={filename || undefined} />
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-xs text-zinc-400">{t("source.optionalVideo")}</span>
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
          </div>
          <FileUpload
            onFile={onVideoFile}
            disabled={disabled}
            filename={videoFilename || undefined}
            accept="video"
            label={t("source.dropVideo")}
            sublabel={t("source.dropVideoHint")}
          />
        </div>
      )}
    </div>
  );
}
