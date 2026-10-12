"use client";

import { useI18n } from "@/app/i18n/I18nProvider";
import Modal from "./Modal";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"] as const;

/**
 * Everything the editor can do, grouped. Each section's items live in one translation string, one
 * "keys — what it does" pair per line, so adding a shortcut is a one-line change per language.
 */
export default function EditorHelp({ open, onClose }: Props) {
  const { t } = useI18n();
  return (
    <Modal open={open} title={t("help.title")} onClose={onClose}>
      <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
        {SECTIONS.map((s) => (
          <section key={s}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{t(`help.${s}.title`)}</h3>
            <dl className="flex flex-col gap-1.5 text-sm">
              {t(`help.${s}.items`)
                .split("\n")
                .map((line) => {
                  const cut = line.indexOf(" — ");
                  const keys = cut === -1 ? "" : line.slice(0, cut);
                  const what = cut === -1 ? line : line.slice(cut + 3);
                  return (
                    <div key={line} className="grid grid-cols-[minmax(7rem,12rem)_1fr] gap-3">
                      <dt className="font-mono text-xs leading-5 text-blue-300">{keys}</dt>
                      <dd className="text-zinc-300">{what}</dd>
                    </div>
                  );
                })}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
