import { translate, type Lang, type MessageKey } from "@/app/i18n";

type Vars = Record<string, string | number>;

/**
 * An error the user is meant to read. It carries a translation key instead of fixed text, so code
 * deep in /lib can throw it and the API boundary renders it in the requester's language.
 * `message` is the Spanish text, which is what ends up in server logs.
 */
export class AppError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly vars?: Vars,
    readonly status?: number
  ) {
    super(translate("es", key, vars));
    this.name = "AppError";
  }
}

/** Text to show for any thrown value: translated for AppError, the raw message otherwise. */
export function errorMessage(err: unknown, lang: Lang, fallback: MessageKey): string {
  if (err instanceof AppError) return translate(lang, err.key, err.vars);
  if (err instanceof Error && err.message) return err.message;
  return translate(lang, fallback);
}
