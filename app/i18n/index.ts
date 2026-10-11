import es from "./es.json";
import en from "./en.json";

export type Lang = "es" | "en";
export type MessageKey = keyof typeof es;

/** Languages offered in Settings, each named in its own language. */
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
];

export const DEFAULT_LANG: Lang = "es";
export const LANG_COOKIE = "ultrasongs-lang";

/** `Record<MessageKey, string>` makes a missing key in en.json a compile error. */
const messages: Record<Lang, Record<MessageKey, string>> = { es, en };

export function isLang(value: unknown): value is Lang {
  return value === "es" || value === "en";
}

/** Looks a key up and fills `{name}` placeholders. Falls back to Spanish, then to the key itself. */
export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = messages[lang][key] ?? messages[DEFAULT_LANG][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** BCP-47 locale for date/number formatting. */
export function localeFor(lang: Lang): string {
  return lang === "en" ? "en-US" : "es-AR";
}
