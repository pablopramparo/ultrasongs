/**
 * Ultrastar note kinds:
 *  ":" normal · "*" golden (the star) · "F" freestyle (not sung or scored)
 *  "R" rap (scored by rhythm, pitch ignored) · "G" golden rap
 */
export type NoteType = ":" | "*" | "F" | "R" | "G";

export interface EditorNote {
  id: string;
  syllable: string;
  startSec: number;
  durationSec: number;
  pitch: number; // MIDI 0-127
  type: NoteType;
  /**
   * First note of a phrase (a "-" line precedes it in the .txt). Undefined on notes that never
   * had phrase information: see hasLineMarks / inferLineStarts.
   */
  lineStart?: boolean;
  /** Legacy (old drafts): converted to a loose marker by detachBreakMarks. */
  breakAfter?: boolean;
  /**
   * Own position (seconds) of the "-" line that opens this phrase, independent of the note: moving
   * the note leaves it where it was (it is held inside the gap before the note). Undefined = placed
   * automatically. Only meaningful together with `lineStart`.
   */
  breakSec?: number;
}

/**
 * Seconds at which the phrase marker before `sorted[i]` sits: its own `breakSec` held inside the gap
 * between the previous note's end and this note's start, or this note's start when it has none.
 */
export function phraseBreakSec(sorted: EditorNote[], i: number): number {
  const n = sorted[i];
  if (n.breakSec === undefined) return n.startSec;
  const prevEnd = i > 0 ? sorted[i - 1].startSec + sorted[i - 1].durationSec : 0;
  return Math.min(n.startSec, Math.max(prevEnd, n.breakSec));
}

/**
 * Drafts saved while notes could carry their own phrase end (`breakAfter`) are converted to a loose
 * marker: the next note opens a phrase and its marker sits right where the flagged note ends, so the
 * export is the same and the marker can be dragged. A marker the next note already positioned wins.
 */
export function detachBreakMarks(notes: EditorNote[]): EditorNote[] {
  if (!notes.some((n) => n.breakAfter !== undefined)) return notes;
  const order = [...notes].sort((a, b) => a.startSec - b.startSec);
  const next = new Map<string, EditorNote>();
  order.forEach((n, i) => {
    if (n.breakAfter && order[i + 1]) next.set(n.id, order[i + 1]);
  });
  const opens = new Map<string, number>();
  for (const [id, nx] of next) {
    const n = order.find((o) => o.id === id)!;
    opens.set(nx.id, n.startSec + n.durationSec);
  }
  return notes.map((n) => {
    const { breakAfter: _drop, ...rest } = n;
    void _drop;
    const end = opens.get(n.id);
    if (end === undefined) return rest;
    return { ...rest, lineStart: true, breakSec: n.breakSec ?? end };
  });
}

/** Silence between two notes (seconds) from which a new phrase is assumed to start. */
export const LINE_BREAK_GAP_SEC = 0.4;

/** True when the notes already say where phrases start (even if they are all false). */
export function hasLineMarks(notes: EditorNote[]): boolean {
  return notes.some((n) => n.lineStart !== undefined);
}

/**
 * Marks the first note after every pause of `gapSec` or more. Used for songs that carry no phrase
 * information (older drafts), so the editor shows - and exports - the same phrases.
 */
export function inferLineStarts(notes: EditorNote[], gapSec = LINE_BREAK_GAP_SEC): EditorNote[] {
  let prevEnd = -Infinity;
  return notes.map((n, i) => {
    const start = i > 0 && n.startSec - prevEnd >= gapSec;
    prevEnd = n.startSec + n.durationSec;
    return { ...n, lineStart: start };
  });
}

const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Drafts saved before word starts carried a leading space hold syllables with no spaces at all, so
 * Ultrastar shows each line glued together. When no note has one, this walks the lyrics word by word
 * against the syllables (in time order) and puts the space on the first syllable of every word that
 * does not open a phrase. Notes that do not match the lyrics (edited text, extra notes) are left as
 * they are, and a song that already has spaces is returned untouched.
 */
export function withWordSpaces(notes: EditorNote[], lyrics: string | undefined): EditorNote[] {
  if (!lyrics?.trim() || notes.length === 0) return notes;
  if (notes.some((n) => n.syllable.startsWith(" "))) return notes;

  const words = lyrics.split(/\s+/).map(letters).filter(Boolean);
  const order = [...notes].sort((a, b) => a.startSec - b.startSec);
  const starts = new Set<string>();
  let wi = 0;
  let pos = 0;

  for (const n of order) {
    const s = letters(n.syllable);
    if (!s || wi >= words.length) continue; // "~", "+", …: continuation of the previous note
    let hit = words[wi].startsWith(s, pos);
    if (!hit) {
      // Lost sync (a word was skipped or edited): the syllable may open one of the next few words
      for (let k = wi + 1; k <= Math.min(wi + 3, words.length - 1) && !hit; k++) {
        if (words[k].startsWith(s)) { wi = k; pos = 0; hit = true; }
      }
    }
    if (!hit) continue;
    if (pos === 0) starts.add(n.id);
    pos += s.length;
    if (pos >= words[wi].length) { wi++; pos = 0; }
  }

  const first = order[0]?.id;
  return notes.map((n) =>
    starts.has(n.id) && n.id !== first && !n.lineStart ? { ...n, syllable: ` ${n.syllable}` } : n
  );
}
