const LANGUAGE_MARKERS: Record<string, ReadonlySet<string>> = {
  it: new Set([
    "che", "per", "della", "delle", "degli", "dello", "questo", "questa", "quello", "quella",
    "hanno", "tutto", "tutta", "tutti", "tutte", "nessuno", "nessuna", "quindi", "fino", "anche",
    "lei", "voi", "gli", "sulle", "sugli", "nelle", "nella", "allora", "ero", "eravamo", "perche",
    "dove", "cosa", "qualcuno", "qualcosa", "ecco", "pure", "ancora", "mentre", "allora",
  ]),
  en: new Set([
    "the", "and", "you", "that", "this", "with", "have", "your", "are", "was", "were", "from",
    "but", "what", "when", "where", "who", "why", "how", "she", "her", "his", "they", "them",
    "their", "our", "will", "would", "could", "should", "there", "here", "because", "through",
  ]),
  es: new Set([
    "que", "por", "para", "pero", "porque", "aunque", "tambien", "entonces", "todos", "todas",
    "cada", "sobre", "entre", "sin", "soy", "eres", "estoy", "estas", "estan", "tiene", "tienen",
    "hacer", "hace", "donde", "cuando", "quien", "cual", "muy", "desde", "hasta", "nunca",
  ]),
  pt: new Set([
    "que", "nao", "mas", "voce", "voces", "seu", "seus", "suas", "estao", "sao", "tambem", "muito",
    "muita", "nos", "eles", "elas", "pelo", "pela", "mais", "quando", "onde", "quem", "tenho", "tem",
    "tinha", "fazer", "ainda", "nunca", "porque", "estou", "estamos",
  ]),
  fr: new Set([
    "les", "des", "une", "est", "pas", "avec", "dans", "pour", "sur", "qui", "je", "vous", "nous",
    "elle", "elles", "ils", "sont", "etes", "etre", "avoir", "tres", "toujours", "jamais", "parce",
    "quand", "ou", "chez", "mais", "mon", "mes", "leur", "leurs",
  ]),
  de: new Set([
    "der", "die", "das", "und", "nicht", "ist", "ein", "eine", "mit", "auf", "ich", "wir", "ihr",
    "von", "fur", "was", "sind", "war", "hat", "haben", "wie", "wenn", "dass", "doch", "noch",
    "auch", "bin", "sein", "zum", "zur", "ins", "wird", "werden",
  ]),
};

/**
 * Infers a likely language from distinctive function words in the supplied lyrics.
 * Returns null when the text is too short or ambiguous, leaving Whisper to detect it.
 */
export function inferLyricsLanguage(lyrics: string): string | null {
  const words = lyrics
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z]+/g) ?? [];
  if (words.length < 12) return null;

  const scores = Object.entries(LANGUAGE_MARKERS).map(([language, markers]) => ({
    language,
    score: words.reduce((sum, word) => sum + Number(markers.has(word)), 0),
  })).sort((a, b) => b.score - a.score);

  const winner = scores[0];
  const runnerUp = scores[1];
  if (winner.score < 4 || winner.score - runnerUp.score < 2) return null;
  return winner.language;
}
