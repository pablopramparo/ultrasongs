import { NextResponse } from "next/server";
import { translate, type MessageKey } from "@/app/i18n";
import { getRequestLang } from "@/app/i18n/server";
import { AppError, errorMessage } from "./appError";

/**
 * Error responses in the requester's language (the language cookie travels with every same-origin
 * request). Bodies keep the `{ message: string }` shape the UI already reads; `code` is the key.
 */
export async function apiError(
  key: MessageKey,
  status: number,
  vars?: Record<string, string | number>
): Promise<NextResponse> {
  const lang = await getRequestLang();
  return NextResponse.json({ message: translate(lang, key, vars), code: key }, { status });
}

/** Response for a caught error: AppError is translated, anything else keeps its own message. */
export async function apiFailure(err: unknown, fallback: MessageKey, status = 500): Promise<NextResponse> {
  // request.json() on a malformed body: don't leak the parser's message.
  if (err instanceof SyntaxError) return apiError("api.badRequest", 400);
  const lang = await getRequestLang();
  const code = err instanceof AppError ? err.key : fallback;
  return NextResponse.json(
    { message: errorMessage(err, lang, fallback), code },
    { status: err instanceof AppError && err.status ? err.status : status }
  );
}
