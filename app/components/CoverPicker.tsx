"use client";

import { useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

interface Props {
  /** Image to preview; null when there is none yet. */
  coverUrl: string | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}

/** Shows the song's cover (embedded in the mp3, or picked here) with a button to replace it. */
export default function CoverPicker({ coverUrl, onFile, disabled }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  // The URL that failed to load: a new URL (the server may only have a cover from now on) is retried
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  const shown = coverUrl && coverUrl !== brokenUrl ? coverUrl : null;

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="h-full w-full object-cover" onError={() => setBrokenUrl(shown)} />
        ) : (
          <svg className="h-6 w-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4-4a2 2 0 012.8 0L16 17m-2-2l1-1a2 2 0 012.8 0L20 16M4 6h16v12H4zM15 9.5h.01" />
          </svg>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="text-sm text-zinc-300">{t("cover.label")}</span>
        {!shown && <span className="text-xs text-zinc-500">{t("cover.none")}</span>}
        <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="btn btn-secondary">
          {shown ? t("cover.replace") : t("cover.add")}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
