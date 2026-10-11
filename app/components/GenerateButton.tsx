"use client";

import { useI18n } from "@/app/i18n/I18nProvider";
type Phase = "idle" | "uploading" | "transcribing" | "generating" | "done" | "error";

interface Props {
  phase: Phase;
  onClick: () => void;
  disabled?: boolean;
}

const LABEL_KEYS = {
  idle: "generate.idle",
  uploading: "generate.uploading",
  transcribing: "generate.transcribing",
  generating: "generate.generating",
  done: "generate.done",
  error: "generate.error",
} as const;

export default function GenerateButton({ phase, onClick, disabled }: Props) {
  const { t } = useI18n();
  const busy = phase === "uploading" || phase === "transcribing" || phase === "generating";

  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="btn btn-primary w-full py-3"
    >
      {busy && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
      {t(LABEL_KEYS[phase])}
    </button>
  );
}
