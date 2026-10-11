"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";
import type { MessageKey } from "@/app/i18n";

interface SetupEvent {
  step: string;
  message: string;
  key?: MessageKey;
  vars?: Record<string, string | number>;
  progress: number;
  done?: boolean;
  error?: string;
}

interface Status {
  home: string;
  cuda: boolean;
  gpuName: string | null;
}

interface Props {
  status: Status;
  onDone: () => void;
}

const STEPS = [
  { id: "gpu", labelKey: "setup.stepGpu" },
  { id: "python", labelKey: "setup.stepPython" },
  { id: "venv", labelKey: "setup.stepVenv" },
  { id: "torch", labelKey: "setup.stepTorch" },
  { id: "packages", labelKey: "setup.stepPackages" },
  { id: "models", labelKey: "setup.stepModels" },
] as const;

/** First-run installer: downloads Python, PyTorch and the models, with live progress. */
export default function SetupScreen({ status, onDone }: Props) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [event, setEvent] = useState<SetupEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Without an NVIDIA GPU the pipeline is several times slower than real time: say so before
  // downloading gigabytes, and only continue once the user has seen it.
  const [confirmed, setConfirmed] = useState(status.cuda);
  const started = useRef(false);

  const start = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/run", { method: "POST" });
      if (!res.ok || !res.body) throw new Error(t("setup.startFailed", { status: res.status }));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finished = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const e = JSON.parse(part.slice(6)) as SetupEvent;
          setEvent(e);
          if (e.error) throw new Error(e.error);
          if (e.done) finished = true;
        }
      }
      if (!finished) throw new Error(t("setup.connectionLost"));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("setup.failed"));
      setRunning(false);
    }
  }, [onDone, t]);

  useEffect(() => {
    if (!confirmed || started.current) return;
    started.current = true;
    start();
  }, [confirmed, start]);

  const pct = Math.round((event?.progress ?? 0) * 100);
  const currentIdx = STEPS.findIndex((s) => s.id === event?.step);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{t("setup.title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("setup.intro")}
        </p>
      </div>

      {!status.cuda && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <p className="font-semibold">{t("setup.cpuWarnTitle")}</p>
          <p className="text-xs leading-relaxed">{t("setup.cpuWarnBody")}</p>
          {!confirmed && (
            <button
              onClick={() => setConfirmed(true)}
              className="self-start rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              {t("setup.cpuContinue")}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span className="truncate pr-3">{event ? (event.key ? t(event.key, event.vars) : event.message) : t("setup.starting")}</span>
          <span className="font-mono">{pct}%</span>
        </div>
      </div>

      <ol className="flex flex-col gap-1.5 text-sm">
        {STEPS.map((s, i) => {
          const state = currentIdx < 0 ? "todo" : i < currentIdx ? "done" : i === currentIdx ? "now" : "todo";
          return (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  state === "done"
                    ? "bg-green-600 text-white"
                    : state === "now"
                    ? "animate-pulse bg-blue-600 text-white"
                    : "bg-zinc-200 text-zinc-400 dark:bg-zinc-800"
                }`}
              >
                {state === "done" ? "✓" : ""}
              </span>
              <span className={state === "todo" ? "text-zinc-400" : "text-zinc-700 dark:text-zinc-200"}>
                {t(s.labelKey)}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-zinc-400">
        {status.cuda ? t("setup.gpuDetected", { name: status.gpuName ?? "" }) : t("setup.noGpu")}
        {" · "}{t("setup.installedIn")} <span className="font-mono">{status.home}</span>
      </p>

      {error && (
        <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <pre className="whitespace-pre-wrap break-words font-sans text-xs">{error}</pre>
          <button
            onClick={start}
            disabled={running}
            className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {t("action.retry")}
          </button>
        </div>
      )}
    </main>
  );
}
