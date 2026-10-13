"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

interface UpdateEvent {
  phase: "downloading" | "installing" | "error";
  downloaded: number;
  total: number | null;
}

interface TauriEvents {
  listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
}

/** The desktop shell reports update downloads through the `update-progress` event; nothing in a browser. */
export default function UpdateProgress() {
  const { t } = useI18n();
  const [state, setState] = useState<UpdateEvent | null>(null);

  useEffect(() => {
    const events = (window as unknown as { __TAURI__?: { event?: TauriEvents } }).__TAURI__?.event;
    if (!events) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    events
      .listen<UpdateEvent>("update-progress", (e) => setState(e.payload))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => { /* no event bridge: no progress to show */ });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!state) return null;

  const pct = state.total ? Math.min(100, Math.round((state.downloaded / state.total) * 100)) : null;
  const text =
    state.phase === "error"
      ? t("update.failed")
      : state.phase === "installing"
        ? t("update.installing")
        : pct !== null
          ? t("update.downloading", { pct })
          : t("update.downloadingMb", { mb: (state.downloaded / 1048576).toFixed(1) });

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-xs text-zinc-200 shadow-lg"
    >
      <span className={state.phase === "error" ? "text-red-400" : undefined}>{text}</span>
      {state.phase === "downloading" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-blue-500 transition-[width]"
            style={{ width: pct !== null ? `${pct}%` : "100%", opacity: pct !== null ? 1 : 0.4 }}
          />
        </div>
      )}
    </div>
  );
}
