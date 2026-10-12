"use client";

import { useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";

interface TauriCore {
  invoke: <T>(cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => Promise<T>;
}

function tauriCore(): TauriCore | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI__?: { core?: TauriCore } }).__TAURI__?.core ?? null;
}

interface Props {
  /** Object URL of the generated file. */
  url: string;
  filename: string;
  label: string;
  className?: string;
}

/**
 * Download link. In a browser it is a plain `<a download>`. The desktop webview does not save blob
 * downloads (the click appears to do nothing), so there the bytes go to the shell, which asks where
 * to save the file and writes it.
 */
export default function DownloadButton({ url, filename, label, className }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<{ kind: "saved"; path: string } | { kind: "error" } | null>(null);
  const [busy, setBusy] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    const core = tauriCore();
    if (!core) return; // the browser handles it
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const saved = await core.invoke<string | null>("save_download", bytes, {
        headers: { "x-filename": encodeURIComponent(filename) },
      });
      if (saved) setStatus({ kind: "saved", path: saved });
    } catch {
      setStatus({ kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <a href={url} download={filename} onClick={onClick} aria-busy={busy} className={className}>
        {label}
      </a>
      {status?.kind === "saved" && (
        <span className="break-all text-xs text-zinc-400">
          {t("download.savedTo")} <span className="font-mono">{status.path}</span>
        </span>
      )}
      {status?.kind === "error" && <span className="text-xs text-red-400">{t("download.failed")}</span>}
    </div>
  );
}
