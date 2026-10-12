"use client";

import { useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

interface TauriCore {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

/** The desktop shell's command bridge; null in a plain browser (dev, `next start`). */
function tauriCore(): TauriCore | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI__?: { core?: TauriCore } }).__TAURI__?.core ?? null;
}

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; version: string }
  | { kind: "installing" }
  | { kind: "error"; message: string };

/** Opens in the system browser from the desktop shell; a normal new-tab link elsewhere. */
function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        const core = tauriCore();
        if (!core) return;
        e.preventDefault();
        core.invoke("open_external", { url: href }).catch(() => { /* ignore */ });
      }}
      className="text-blue-400 underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

/** Version, update check (desktop app only) and credits. */
export default function AboutPanel() {
  const { t } = useI18n();
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  // Settings only renders after a client-side navigation, so reading window here is safe.
  const [desktop] = useState(() => tauriCore() !== null);

  const check = async () => {
    const core = tauriCore();
    if (!core) return;
    setState({ kind: "checking" });
    try {
      const r = await core.invoke<{ available: boolean; version?: string }>("check_update");
      setState(r.available && r.version ? { kind: "available", version: r.version } : { kind: "upToDate" });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  };

  const install = async () => {
    const core = tauriCore();
    if (!core) return;
    setState({ kind: "installing" });
    try {
      await core.invoke("install_update"); // the app restarts when this finishes
      setState({ kind: "upToDate" }); // only reached if there was nothing to install
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  };

  const busy = state.kind === "checking" || state.kind === "installing";

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-100">Ultrasongs</h3>
        {VERSION && (
          <span className="font-mono text-xs text-zinc-400">
            {t("about.version")} {VERSION}
          </span>
        )}
      </div>

      {desktop ? (
        <div className="flex flex-wrap items-center gap-3">
          {state.kind === "available" ? (
            <button type="button" onClick={install} className="btn btn-primary !h-8 !px-3 !py-0 text-xs">
              {t("about.install", { v: state.version })}
            </button>
          ) : (
            <button type="button" onClick={check} disabled={busy} className="btn btn-secondary !h-8 !px-3 !py-0 text-xs">
              {state.kind === "checking" ? t("about.checking") : t("about.check")}
            </button>
          )}
          <span className="text-xs text-zinc-400" role="status">
            {state.kind === "upToDate" && t("about.upToDate")}
            {state.kind === "available" && t("about.available", { v: state.version })}
            {state.kind === "installing" && t("about.installing")}
            {state.kind === "error" && <span className="text-red-400">{t("about.error")}</span>}
          </span>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">{t("about.desktopOnly")}</p>
      )}

      <div className="flex flex-col gap-1.5 border-t border-zinc-800 pt-4 text-xs leading-relaxed text-zinc-400">
        <p>
          {t("about.builtBy")} <ExternalLink href="https://github.com/pablopramparo">Pablo Pramparo</ExternalLink>
          {" · "}
          <ExternalLink href="https://github.com/pablopramparo/ultrasongs">{t("about.sourceCode")}</ExternalLink>
          {" · "}
          <ExternalLink href="https://github.com/sponsors/pablopramparo">{t("about.support")}</ExternalLink>
        </p>
        <p>
          {t("about.poweredBy")}{" "}
          <ExternalLink href="https://github.com/facebookresearch/demucs">Demucs</ExternalLink>,{" "}
          <ExternalLink href="https://github.com/SYSTRAN/faster-whisper">faster-whisper</ExternalLink>,{" "}
          <ExternalLink href="https://github.com/m-bain/whisperX">WhisperX</ExternalLink>,{" "}
          <ExternalLink href="https://github.com/maxrmorrison/torchcrepe">torchcrepe</ExternalLink>{" · "}
          <ExternalLink href="https://github.com/yt-dlp/yt-dlp">yt-dlp</ExternalLink>.
        </p>
        <p>
          {t("about.format")} <ExternalLink href="https://ultrastar-es.org">UltraStar Deluxe</ExternalLink>. {t("about.license")}
        </p>
      </div>
    </div>
  );
}
