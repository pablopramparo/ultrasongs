"use client";

import { useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";

export interface YoutubeResult {
  id: string;
  mp3: string;
  videoPath: string;
  title: string;
}

interface Props {
  onResult: (result: YoutubeResult) => void;
  disabled?: boolean;
  /** Name of the audio currently loaded, shown as a confirmation. */
  loadedTitle?: string;
}

export default function YoutubeInput({ onResult, disabled, loadedTitle }: Props) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      onResult(data as YoutubeResult);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("youtube.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleDownload()}
          disabled={disabled || loading}
          placeholder={t("youtube.placeholder")}
          className="field min-w-0 flex-1"
        />
        <button
          onClick={handleDownload}
          disabled={disabled || loading || !url.trim()}
          className="btn btn-primary shrink-0"
        >
          {loading ? t("youtube.downloading") : t("youtube.download")}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {loadedTitle && !error && (
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {t("youtube.loaded")} <span className="font-medium text-zinc-700 dark:text-zinc-300">{loadedTitle}</span>
        </p>
      )}
    </div>
  );
}
