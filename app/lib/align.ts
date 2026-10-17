import { splitWord } from "./syllabify";
import type { WordTimestamp, Pause } from "../api/transcribe/route";

export interface AlignedSyllable {
  syllable: string;
  start: number; // seconds
  end: number;   // seconds
  midi: number;
  isLineBreak?: boolean;
}

interface PitchFrame {
  time: number;
  midi: number;
  confidence: number;
}

interface WordWithPitch extends WordTimestamp {
  pitchFrames?: PitchFrame[];
}

const MAX_IN_LINE_GAP_SEC = 4;
const SKIP_LYRIC_WORD_COST = 0.48;
const SKIP_TRANSCRIPT_WORD_COST = 0.18;

/** Levenshtein distance between two strings. */
function levenshtein(a: string, b: string): number {
  if (a.length > b.length) [a, b] = [b, a];
  let previous = Array.from({ length: a.length + 1 }, (_, i) => i);
  let current = new Array<number>(a.length + 1);

  for (let i = 1; i <= b.length; i++) {
    current[0] = i;
    for (let j = 1; j <= a.length; j++) {
      current[j] =
        a[j - 1] === b[i - 1]
          ? previous[j - 1]
          : 1 + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    [previous, current] = [current, previous];
  }

  return previous[a.length];
}

function normalize(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Text similarity score between a lyric word and a Whisper word.
 * 0 = perfect match, approaching 1 = bad.
 */
function wordScore(lNorm: string, wNorm: string): number {
  if (wNorm === lNorm) return 0;
  if (lNorm.length >= 3 && wNorm.length > lNorm.length && wNorm.endsWith(lNorm)) return 0.05;
  if (lNorm.length >= 3 && wNorm.startsWith(lNorm)) return 0.1;

  const maxScore = maxTextScore(lNorm);
  if (Math.abs(lNorm.length - wNorm.length) > maxScore * Math.max(lNorm.length, wNorm.length, 1)) {
    return Infinity;
  }

  const dist = levenshtein(lNorm, wNorm);
  return dist / Math.max(lNorm.length, wNorm.length, 1);
}

function maxTextScore(lNorm: string): number {
  if (lNorm.length <= 2) return 0.05;
  if (lNorm.length === 3) return 0.26;
  if (lNorm.length <= 5) return 0.28;
  return 0.45;
}

/**
 * Aligns the complete lyric and transcript sequences together. Greedy line-by-line matching can
 * consume a later chorus when a rap line is poorly recognized, leaving the following lyric lines
 * with no anchors. A monotonic sequence alignment keeps repeated phrases in their actual order.
 */
function matchWords(
  lyricWords: string[],
  whisperWords: WordTimestamp[],
  whisperNorm: string[]
): Array<WordTimestamp | null> {
  const cols = whisperWords.length + 1;
  const costs = new Float64Array((lyricWords.length + 1) * cols);
  const steps = new Uint8Array(costs.length); // 1 = skip lyric, 2 = skip transcript, 3 = match
  costs.fill(Infinity);
  costs[0] = 0;

  for (let j = 1; j <= whisperWords.length; j++) {
    costs[j] = costs[j - 1] + SKIP_TRANSCRIPT_WORD_COST;
    steps[j] = 2;
  }

  for (let i = 1; i <= lyricWords.length; i++) {
    const row = i * cols;
    costs[row] = costs[row - cols] + SKIP_LYRIC_WORD_COST;
    steps[row] = 1;

    const lyricNorm = normalize(lyricWords[i - 1]);
    for (let j = 1; j <= whisperWords.length; j++) {
      const cell = row + j;
      let bestCost = costs[cell - cols] + SKIP_LYRIC_WORD_COST;
      let step = 1;

      const skipTranscript = costs[cell - 1] + SKIP_TRANSCRIPT_WORD_COST;
      if (skipTranscript < bestCost) {
        bestCost = skipTranscript;
        step = 2;
      }

      if (lyricNorm) {
        const textScore = wordScore(lyricNorm, whisperNorm[j - 1]);
        if (textScore <= maxTextScore(lyricNorm)) {
          const shortWordPenalty = lyricNorm.length <= 2 ? 0.12 : 0;
          const matchCost = costs[cell - cols - 1] + textScore + shortWordPenalty;
          if (matchCost < bestCost) {
            bestCost = matchCost;
            step = 3;
          }
        }
      }

      costs[cell] = bestCost;
      steps[cell] = step;
    }
  }

  const matched: Array<WordTimestamp | null> = Array(lyricWords.length).fill(null);
  let i = lyricWords.length;
  let j = whisperWords.length;
  while (i > 0 || j > 0) {
    const step = steps[i * cols + j];
    if (step === 3) {
      matched[i - 1] = whisperWords[j - 1];
      i--;
      j--;
    } else if (step === 1) {
      i--;
    } else if (step === 2) {
      j--;
    } else {
      break;
    }
  }

  return matched;
}

/** Drops isolated phrase matches when the transcript has latched onto a repeated or noisy phrase. */
function keepBestLineCluster(
  matched: Array<WordTimestamp | null>,
  lineWords: string[]
): Array<WordTimestamp | null> {
  const clusters: Array<Array<number>> = [];
  for (let pos = 0; pos < matched.length; pos++) {
    const current = matched[pos];
    if (!current) continue;
    const prevCluster = clusters[clusters.length - 1];
    const prevPos = prevCluster?.[prevCluster.length - 1];
    const startsNewCluster =
      prevPos !== undefined && current.start - matched[prevPos]!.start > MAX_IN_LINE_GAP_SEC;

    if (!prevCluster || startsNewCluster) clusters.push([pos]);
    else prevCluster.push(pos);
  }

  let kept = [...matched];
  if (clusters.length > 1) {
    const keep = clusters.reduce((best, cluster) =>
      cluster.length > best.length ? cluster : best
    );
    const keepSet = new Set(keep);
    for (let pos = 0; pos < matched.length; pos++) {
      if (!keepSet.has(pos)) kept[pos] = null;
    }
  }

  const keptTimes = kept.filter((m): m is WordTimestamp => m !== null).map((m) => m.start);
  const keptSignificantMatches = kept.filter((m) => m && normalize(m.word).length > 2).length;
  const lineSpan = keptTimes.length > 1
    ? Math.max(...keptTimes) - Math.min(...keptTimes)
    : 0;
  const maxLineSpan = Math.max(12, lineWords.length * 3);

  if (
    (lineWords.length >= 4 && keptSignificantMatches === 0) ||
    (lineWords.length >= 4 && lineSpan > maxLineSpan)
  ) {
    return lineWords.map(() => null);
  }

  return kept;
}

const SNAP_MIN_WORD_SEC = 0.12;   // below this per word the voiced stretch is too short to trust
const SNAP_MAX_WORD_SEC = 1.0;    // don't let a snapped word sprawl over a long stretch

/**
 * Fills in timestamps for lyric words the transcription missed.
 * Missing words that open the line of the next anchor are packed right before it, inside the
 * voiced stretch after the last pause ("[No] one ever starts"); the rest is spread evenly.
 * The mirror rule (words closing the previous anchor's line) is deliberately absent: lines
 * with a long breath in the middle ("who to ... betray") made it place words seconds early.
 */
function interpolateMissing(
  matched: Array<WordTimestamp | null>,
  lyricWords: string[],
  lineOf: number[] = [],
  pauses: Pause[] = []
): WordTimestamp[] {
  const result: Array<WordTimestamp> = matched.map((m, i) =>
    m ?? { word: lyricWords[i], start: -1, end: -1, midi: 60 }
  );

  const anchors = result
    .map((r, i) => (r.start >= 0 ? i : -1))
    .filter((i) => i >= 0);

  if (anchors.length === 0) return result;

  const first = anchors[0];
  if (first > 0) {
    const firstAnchorStart = result[first].start;
    const start = Math.max(0, firstAnchorStart - first);
    const slot = (firstAnchorStart - start) / first;
    for (let i = 0; i < first; i++) {
      result[i].start = start + i * slot;
      result[i].end = start + (i + 1) * slot;
      result[i].midi = result[first].midi;
    }
  }

  const last = anchors[anchors.length - 1];
  const fallbackWordSec = 0.3;
  for (let i = last + 1; i < result.length; i++) {
    const offset = (i - last) * fallbackWordSec;
    result[i].start = result[last].end + offset;
    result[i].end = result[last].end + offset + fallbackWordSec;
    result[i].midi = result[last].midi;
  }

  for (let ai = 0; ai < anchors.length - 1; ai++) {
    const a = anchors[ai];
    const b = anchors[ai + 1];
    const gap = b - a;
    if (gap <= 1) continue;

    const tStart = result[a].end;
    const tEnd = result[b].start;
    const midiA = result[a].midi;
    const midiB = result[b].midi;

    const lo = a + 1;     // first index still to place
    let hi = b - 1;       // last index still to place
    const restStart = tStart;
    let restEnd = tEnd;
    const inGap = pauses.filter((p) => p.start >= tStart - 1e-6 && p.end <= tEnd + 1e-6);

    if (inGap.length > 0 && lineOf.length > 0) {
      // Words that open the line of the next anchor: right before it, after the last pause.
      let pre = b;
      while (pre - 1 > a && lineOf[pre - 1] === lineOf[b]) pre--;
      const nPre = b - pre;
      const lastPause = inGap.reduce((best, p) => (p.end > best.end ? p : best));
      if (nPre > 0) {
        const from = Math.max(lastPause.end, tEnd - nPre * SNAP_MAX_WORD_SEC);
        if (tEnd - from >= nPre * SNAP_MIN_WORD_SEC) {
          const slot = (tEnd - from) / nPre;
          for (let i = 0; i < nPre; i++) {
            result[pre + i].start = from + i * slot;
            result[pre + i].end = from + (i + 1) * slot;
            result[pre + i].midi = midiB;
          }
          hi = pre - 1;
          restEnd = lastPause.start;
        }
      }

      if (restEnd <= restStart) restEnd = tEnd;
    }

    // Whatever is left (whole unmatched lines, or no usable pause): spread evenly.
    const rest = hi - lo + 1;
    const restDuration = restEnd - restStart;
    for (let j = 1; j <= rest; j++) {
      const idx = lo + j - 1;
      const frac = j / (rest + 1);
      result[idx].start = restStart + frac * restDuration;
      result[idx].end = restStart + ((j + 1) / (rest + 1)) * restDuration;
      result[idx].midi = Math.round(midiA + ((idx - a) / gap) * (midiB - midiA));
    }
  }

  return result;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function midiForRange(word: WordTimestamp, start: number, end: number): number {
  const frames = (word as WordWithPitch).pitchFrames;
  if (!frames?.length) return word.midi;

  for (const threshold of [0.5, 0.3, 0.1]) {
    const values = frames
      .filter((p) => p.time >= start && p.time <= end && p.confidence > threshold)
      .map((p) => p.midi)
      .filter((m) => Number.isFinite(m) && m > 0);
    const value = median(values);
    if (value !== null) return value;
  }

  return word.midi;
}

const STRETCH_MIN_GAP_SEC = 1.0;      // silence between the two words, as reported by the aligner
const STRETCH_MIN_WORD_SEC = 1.2;     // the word before the gap is suspiciously long
const NOTE_CHANGE_WINDOW_SEC = 0.2;
const NOTE_CHANGE_MIN_SEMITONES = 2;
const NOTE_CHANGE_MIN_FRAMES = 8;

/** First time inside the word where the sung pitch jumps to a different note, or null. */
function firstNoteChange(word: WordTimestamp): number | null {
  const frames = ((word as WordWithPitch).pitchFrames ?? []).filter(
    (p) => p.confidence > 0.5 && p.time >= word.start && p.time <= word.end
  );
  for (const f of frames) {
    if (f.time < word.start + NOTE_CHANGE_WINDOW_SEC) continue;
    if (f.time > word.end - NOTE_CHANGE_WINDOW_SEC) break;
    const before = frames.filter((p) => p.time >= f.time - NOTE_CHANGE_WINDOW_SEC && p.time < f.time);
    const after = frames.filter((p) => p.time >= f.time && p.time < f.time + NOTE_CHANGE_WINDOW_SEC);
    if (before.length < NOTE_CHANGE_MIN_FRAMES || after.length < NOTE_CHANGE_MIN_FRAMES) continue;
    const a = median(before.map((p) => p.midi));
    const b = median(after.map((p) => p.midi));
    if (a !== null && b !== null && Math.abs(a - b) >= NOTE_CHANGE_MIN_SEMITONES) return f.time;
  }
  return null;
}

/**
 * Aligners tend to stretch a word over the rest of a sung phrase and hang the next word on
 * whatever comes after the break (often a wordless "ooh"). Seen as: a very long word, then
 * a gap of a second or more, then another very long word of the same line. When the first
 * one holds more than one note, the next word really starts at the note change — move it
 * back there.
 */
function fixStretchedWords(matched: Array<WordTimestamp | null>): Array<WordTimestamp | null> {
  const out = [...matched];
  for (let k = 1; k < out.length; k++) {
    const prev = out[k - 1];
    const cur = out[k];
    if (!prev || !cur) continue;
    if (cur.start - prev.end < STRETCH_MIN_GAP_SEC) continue;
    if (prev.end - prev.start < STRETCH_MIN_WORD_SEC) continue;
    // A real mid-line breath is followed by a normal-length word; a word hung on a wordless
    // vocalization is stretched too. Repeated vocalizations ("ooh ooh") are long by nature.
    if (cur.end - cur.start < STRETCH_MIN_WORD_SEC) continue;
    if (normalize(prev.word) === normalize(cur.word)) continue;

    const cut = firstNoteChange(prev);
    if (cut === null) continue;

    const frames = (prev as WordWithPitch).pitchFrames;
    const head: WordWithPitch = { ...prev, end: cut };
    const tail: WordWithPitch = { ...prev, word: cur.word, start: cut };
    if (frames) {
      head.pitchFrames = frames.filter((p) => p.time < cut);
      tail.pitchFrames = frames.filter((p) => p.time >= cut);
    }
    out[k - 1] = head;
    out[k] = tail;
  }
  return out;
}

/**
 * Aligns Whisper word timestamps to user-provided lyrics.
 * `pauses` (silences in the separated vocals) mark phrase boundaries for words the
 * transcription missed; they never move a word the transcription did find.
 */
export function alignLyrics(
  lyrics: string,
  whisperWords: WordTimestamp[],
  lang: string,
  pauses: Pause[] = []
): AlignedSyllable[] {
  const lines = lyrics.split("\n").map((l) => l.trim()).filter(Boolean);
  const whisperNorm = whisperWords.map((w) => normalize(w.word));

  const allMatched: Array<WordTimestamp | null> = [];
  const allLyricWords: string[] = [];
  const lineOf: number[] = [];
  const lineWords = lines.map((line) => line.split(/\s+/).filter(Boolean));
  for (const [li, words] of lineWords.entries()) {
    allLyricWords.push(...words);
    words.forEach(() => lineOf.push(li));
  }

  const sequentialMatches = matchWords(allLyricWords, whisperWords, whisperNorm);
  let wordOffset = 0;
  for (const words of lineWords) {
    const end = wordOffset + words.length;
    const lineMatches = keepBestLineCluster(sequentialMatches.slice(wordOffset, end), words);
    allMatched.push(...fixStretchedWords(lineMatches));
    wordOffset = end;
  }

  const interpolated = interpolateMissing(allMatched, allLyricWords, lineOf, pauses);

  const output: AlignedSyllable[] = [];
  let wordIdx = 0;

  for (let li = 0; li < lines.length; li++) {
    const lineWords = lines[li].split(/\s+/).filter(Boolean);

    for (const [wi, word] of lineWords.entries()) {
      const ts = interpolated[wordIdx++];
      const syllables = splitWord(word, lang);
      // Longer syllables (more letters) get proportionally more of the word's time,
      // instead of an equal split that makes "stra-" and "a" the same length.
      const weights = syllables.map((s) => Math.max(1, (s.match(/\p{L}/gu) ?? []).length));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const wordDuration = ts.end - ts.start;
      let offset = 0;

      syllables.forEach((syl, si) => {
        const start = ts.start + (offset / totalWeight) * wordDuration;
        offset += weights[si];
        const end = ts.start + (offset / totalWeight) * wordDuration;
        output.push({
          // UltraStar convention: a leading space marks the start of a new word within a line;
          // without it the game renders the whole line glued together.
          syllable: si === 0 && wi > 0 ? ` ${syl}` : syl,
          start,
          end,
          midi: midiForRange(ts, start, end),
        });
      });
    }

    if (li < lines.length - 1) {
      const nextLineStart = interpolated[wordIdx]?.start ?? output[output.length - 1]?.end ?? 0;
      output.push({ syllable: "", start: nextLineStart, end: nextLineStart, midi: 0, isLineBreak: true });
    }
  }

  return output;
}
