"use client";

import { useI18n } from "@/app/i18n/I18nProvider";
interface Props {
  title: string;
  artist: string;
  lyrics: string;
  onTitle: (v: string) => void;
  onArtist: (v: string) => void;
  onLyrics: (v: string) => void;
  disabled?: boolean;
}

export default function LyricsInput({ title, artist, lyrics, onTitle, onArtist, onLyrics, disabled }: Props) {
  const { t } = useI18n();
  const fieldCls = "field";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">{t("form.title")}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder={t("form.titlePlaceholder")}
            disabled={disabled}
            className={fieldCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">{t("form.artist")}</label>
          <input
            type="text"
            value={artist}
            onChange={(e) => onArtist(e.target.value)}
            placeholder={t("form.artistPlaceholder")}
            disabled={disabled}
            className={fieldCls}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-400">
          {t("form.lyrics")} <span className="text-zinc-500">{t("form.lyricsHint")}</span>
        </label>
        <textarea
          value={lyrics}
          onChange={(e) => onLyrics(e.target.value)}
          placeholder={"Hello darkness my old friend\nI've come to talk with you again"}
          disabled={disabled}
          rows={10}
          className={`${fieldCls} resize-y font-mono leading-relaxed`}
        />
      </div>
    </div>
  );
}
