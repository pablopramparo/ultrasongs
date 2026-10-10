/* eslint-disable @typescript-eslint/no-require-imports -- hyphen is CJS-only, see serverExternalPackages */
const hyphenModules: Record<string, { hyphenateSync: (w: string) => string }> = {
  it: require("hyphen/it"),
  en: require("hyphen/en"),
  "en-us": require("hyphen/en-us"),
  "en-gb": require("hyphen/en-gb"),
  es: require("hyphen/es"),
  fr: require("hyphen/fr"),
  de: require("hyphen/de"),
  pt: require("hyphen/pt"),
  ca: require("hyphen/ca"),
  nl: require("hyphen/nl"),
  pl: require("hyphen/pl"),
  ru: require("hyphen/ru"),
  sv: require("hyphen/sv"),
  nb: require("hyphen/nb"),
  da: require("hyphen/da"),
  fi: require("hyphen/fi"),
  ro: require("hyphen/ro"),
  cs: require("hyphen/cs"),
  sk: require("hyphen/sk"),
  hr: require("hyphen/hr"),
  tr: require("hyphen/tr"),
  eu: require("hyphen/eu"),
  gl: require("hyphen/gl"),
  af: require("hyphen/af"),
};

// Whisper outputs ISO 639-1 codes; map variants and aliases
const LANG_ALIASES: Record<string, string> = {
  "en-us": "en-us",
  "en-gb": "en-gb",
  "zh-tw": "en", // fallback
  "pt-br": "pt",
  "pt-pt": "pt",
  "de-at": "de",
  "de-ch": "de",
  "fr-ca": "fr",
  "fr-be": "fr",
  "nl-be": "nl",
  "sr-latn": "en",  // fallback
  no: "nb",
};

const SOFT_HYPHEN = "­";

function resolveHyphenator(lang: string): { hyphenateSync: (w: string) => string } | null {
  const key = (LANG_ALIASES[lang] ?? lang).toLowerCase();
  return hyphenModules[key] ?? hyphenModules[key.split("-")[0]] ?? null;
}

/**
 * Splits a single word into syllables using TeX hyphenation patterns.
 * Falls back to [word] for unsupported languages or words ≤ 3 chars.
 */
export function splitWord(word: string, lang: string): string[] {
  const clean = word.trim();
  if (!clean || clean.length <= 2) return [clean].filter(Boolean);

  const h = resolveHyphenator(lang);
  if (!h) return [clean];

  try {
    const hyphenated = h.hyphenateSync(clean);
    const parts = hyphenated.split(SOFT_HYPHEN).filter(Boolean);
    // hyphenateSync may return the original word unchanged if no break points found
    return parts.length > 0 ? parts : [clean];
  } catch {
    return [clean];
  }
}

/** Splits all words in a line into syllable arrays. */
export function syllabifyLine(
  line: string,
  lang: string
): Array<{ word: string; syllables: string[] }> {
  return line
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ word, syllables: splitWord(word, lang) }));
}
