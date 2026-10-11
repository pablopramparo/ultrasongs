import { cookies, headers } from "next/headers";
import { DEFAULT_LANG, LANG_COOKIE, isLang, type Lang } from "./index";

/**
 * Language for this request: the saved choice (cookie) first, then the browser's Accept-Language,
 * then the default. Reading request data makes pages that use it dynamic, which is fine here.
 */
export async function getRequestLang(): Promise<Lang> {
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(saved)) return saved;

  const accept = (await headers()).get("accept-language")?.toLowerCase() ?? "";
  if (accept.startsWith("en")) return "en";
  if (accept.startsWith("es")) return "es";
  return DEFAULT_LANG;
}
