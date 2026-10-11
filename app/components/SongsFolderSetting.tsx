"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";

interface Props {
  /** Called after a new folder was saved, so the library list can reload. */
  onChanged: () => void;
}

interface TauriDialog {
  open: (opts: { directory: boolean; title?: string }) => Promise<string | null>;
}

/** Native folder picker when running inside the desktop shell; null in a plain browser. */
function nativePicker(): TauriDialog | null {
  const t = (window as unknown as { __TAURI__?: { dialog?: TauriDialog } }).__TAURI__;
  return t?.dialog ?? null;
}

/** Shows and edits the folder finished songs are written to (the Ultrastar `Songs` folder). */
export default function SongsFolderSetting({ onChanged }: Props) {
  const { t } = useI18n();
  const [dir, setDir] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Only read in event handlers, so it never affects the rendered markup.
  const [picker] = useState<TauriDialog | null>(() => (typeof window === "undefined" ? null : nativePicker()));

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => { setDir(s.songsDir); setLocked(!!s.songsDirLocked); })
      .catch(() => { /* ignore */ });
  }, []);

  const save = useCallback(async (value: string) => {
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songsDir: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setDir(data.songsDir);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.saveFailed"));
    }
  }, [onChanged, t]);

  const choose = async () => {
    if (picker) {
      const picked = await picker.open({ directory: true, title: t("settings.pickTitle") });
      if (picked) await save(picked);
    } else {
      setDraft(dir ?? "");
      setEditing(true);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">{t("settings.songsFolder")}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{t("settings.songsFolderHint")}</p>
        </div>
        {!locked && (
          <button onClick={choose} className="btn btn-secondary shrink-0 !px-3 !py-1.5 text-xs">
            {dir ? t("settings.change") : t("settings.choose")}
          </button>
        )}
      </div>

      <p
        title={dir ?? undefined}
        className="truncate rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300"
      >
        {dir ?? <span className="text-zinc-500">{t("settings.notSet")}</span>}
      </p>

      {editing && (
        <div className="flex flex-col gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save(draft)}
            placeholder={t("settings.pathPlaceholder")}
            className="field font-mono text-xs"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button onClick={() => save(draft)} className="btn btn-primary !px-3 !py-1.5 text-xs">
              {t("action.save")}
            </button>
            <button onClick={() => setEditing(false)} className="px-2 text-xs text-zinc-400 hover:text-zinc-100">
              {t("action.cancel")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      {locked && <p className="text-xs text-zinc-500">{t("settings.lockedByEnv")}</p>}
    </div>
  );
}
