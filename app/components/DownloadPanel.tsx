"use client";

import { useI18n } from "@/app/i18n/I18nProvider";
import DownloadButton from "./DownloadButton";
interface Props {
  url: string | null;
  title: string;
  error: string | null;
  /** Folder the song was also written to (SONGS_DIR), if configured. */
  savedTo?: string | null;
  saveError?: string | null;
}

export default function DownloadPanel({ url, title, error, savedTo, saveError }: Props) {
  const { t } = useI18n();
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!url) return null;

  const filename = `${title || "song"}.zip`;

  return (
    <div className="flex flex-col gap-2">
      {savedTo && (
        <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
          {t("download.savedTo")} <span className="break-all font-mono text-xs">{savedTo}</span>
        </div>
      )}
      {saveError && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
          {t("download.saveError")} {saveError}
        </div>
      )}
      <DownloadButton
        url={url}
        filename={filename}
        label={t("download.button", { filename })}
        className="flex items-center justify-center gap-2 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-950 dark:text-green-400 dark:hover:bg-green-900"
      />
    </div>
  );
}
