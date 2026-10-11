"use client";

import { useI18n } from "@/app/i18n/I18nProvider";
import { LANGUAGES } from "@/app/i18n";
import SongsFolderSetting from "./SongsFolderSetting";

interface Props {
  onBack: () => void;
  /** The songs folder changed: the sidebar library has to be reloaded. */
  onSongsFolderChanged: () => void;
}

/** Application settings: interface language and the Ultrastar songs folder. */
export default function SettingsPanel({ onBack, onSongsFolderChanged }: Props) {
  const { t, lang, setLang } = useI18n();

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-100"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t("action.back")}
        </button>
        <h2 className="text-sm font-semibold text-zinc-100">{t("settings.title")}</h2>
      </div>

      {/* Language */}
      <div className="card flex flex-col gap-3 p-5">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{t("settings.language")}</h3>
          <p className="mt-0.5 text-xs text-zinc-400">{t("settings.languageHint")}</p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLang(l.code)}
              aria-pressed={lang === l.code}
              className={[
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                lang === l.code
                  ? "bg-blue-600/15 text-blue-300 ring-1 ring-inset ring-blue-500/40"
                  : "text-zinc-400 hover:text-zinc-100",
              ].join(" ")}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Songs folder */}
      <div className="card p-5">
        <SongsFolderSetting onChanged={onSongsFolderChanged} />
      </div>
    </section>
  );
}
