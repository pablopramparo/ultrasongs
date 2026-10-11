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

const MAX_FORWARD_SEARCH_SEC = 90;
const MAX_IN_LINE_GAP_SEC = 4;

/** Levenshtein distance between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
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

  const dist = levenshtein(lNorm, wNorm);
  return dist / Math.max(lNorm.length, wNorm.length, 1);
}

function maxTextScore(lNorm: string): number {
  if (lNorm.length <= 2) return 0.05;
  if (lNorm.length === 3) return 0.26;
  if (lNorm.length <= 5) return 0.42;
  return 0.45;
}

function matchLine(
  lineWords: string[],
  whisperWords: WordTimestamp[],
  whisperNorm: string[],
  searchStart: number,
  lastMatchTime: number
): { matched: Array<WordTimestamp | null>; searchStart: number; lastMatchTime: number } {
  const matched: Array<WordTimestamp | null> = [];
  let ss = searchStart;
  let lmt = lastMatchTime;
  const matchedTimes: number[] = [];
  const matchedIndices: Array<number | null> = [];

  for (const lw of lineWords) {
    const lNorm = normalize(lw);
    if (!lNorm) {
      matched.push(null);
      continue;
    }

    let bestIdx = -1;
    let bestScore = Infinity;
    let bestTextScore = Infinity;

    for (let i = ss; i < whisperWords.length; i++) {
      if (lmt >= 0 && whisperWords[i].start > lmt + MAX_FORWARD_SEARCH_SEC) break;
      if (lmt < 0 && whisperWords[i].start > MAX_FORWARD_SEARCH_SEC) break;

      const textScore = wordScore(lNorm, whisperNorm[i]);
      if (textScore > maxTextScore(lNorm)) continue;

      const jump = lmt >= 0
        ? Math.max(0, whisperWords[i].start - lmt - 20)
        : Math.max(0, whisperWords[i].start - 20);
      const score = textScore + jump * (lmt >= 0 ? 0.015 : 0.05);

      if (score < bestScore) {
        bestScore = score;
        bestTextScore = textScore;
        bestIdx = i;
      }
      if (bestScore === 0) break;
    }

    if (bestIdx >= 0 && bestTextScore <= maxTextScore(lNorm)) {
      ss = bestIdx + 1;
      lmt = whisperWords[bestIdx].start;
      matched.push(whisperWords[bestIdx]);
      matchedTimes.push(whisperWords[bestIdx].start);
      matchedIndices.push(bestIdx);
    } else {
      matched.push(null);
      matchedIndices.push(null);
    }
  }

  const clusters: Array<Array<number>> = [];
  for (let pos = 0; pos < matched.length; pos++) {
    const idx = matchedIndices[pos];
    if (idx === null) continue;
    const prevCluster = clusters[clusters.length - 1];
    const prevPos = prevCluster?.[prevCluster.length - 1];
    const prevIdx = prevPos === undefined ? null : matchedIndices[prevPos];
    const startsNewCluster =
      prevIdx !== null &&
      whisperWords[idx].start - whisperWords[prevIdx].start > MAX_IN_LINE_GAP_SEC;

    if (!prevCluster || startsNewCluster) clusters.push([pos]);
    else prevCluster.push(pos);
  }

  if (clusters.length > 1) {
    const keep = clusters.reduce((best, cluster) =>
      cluster.length > best.length ? cluster : best
    );
    const keepSet = new Set(keep);
    for (let pos = 0; pos < matched.length; pos++) {
      if (!keepSet.has(pos)) {
        matched[pos] = null;
        matchedIndices[pos] = null;
      }
    }
    const lastKeptPos = keep[keep.length - 1];
    const lastKeptIdx = matchedIndices[lastKeptPos];
    if (lastKeptIdx !== null) {
      ss = lastKeptIdx + 1;
      lmt = whisperWords[lastKeptIdx].start;
    }
  }

  const keptTimes = matchedIndices
    .filter((idx): idx is number => idx !== null)
    .map((idx) => whisperWords[idx].start);
  const keptSignificantMatches = matched
    .filter((m) => m && normalize(m.word).length > 2)
    .length;
  const lineSpan = keptTimes.length > 1
    ? Math.max(...keptTimes) - Math.min(...keptTimes)
    : 0;
  const maxLineSpan = Math.max(12, lineWords.length * 3);

  if (
    (lineWords.length >= 4 && keptSignificantMatches === 0) ||
    (lineWords.length >= 4 && lineSpan > maxLineSpan)
  ) {
    return {
      matched: lineWords.map(() => null),
      searchStart,
      lastMatchTime,
    };
  }

  return { matched, searchStart: ss, lastMatchTime: lmt };
}

function interpolateMissing(
  matched: Array<WordTimestamp | null>,
  lyricWords: string[]
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
    const duration = tEnd - tStart;
    const midiA = result[a].midi;
    const midiB = result[b].midi;

    for (let k = 1; k < gap; k++) {
      const frac = k / gap;
      result[a + k].start = tStart + frac * duration;
      result[a + k].end = tStart + ((k + 1) / gap) * duration;
      result[a + k].midi = Math.round(midiA + frac * (midiB - midiA));
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
 * Pauses are accepted for API compatibility but are not used as hard anchors.
 */
export function alignLyrics(
  lyrics: string,
  whisperWords: WordTimestamp[],
  lang: string,
  _pauses: Pause[] = []
): AlignedSyllable[] {
  const lines = lyrics.split("\n").map((l) => l.trim()).filter(Boolean);
  const whisperNorm = whisperWords.map((w) => normalize(w.word));

  const allMatched: Array<WordTimestamp | null> = [];
  const allLyricWords: string[] = [];

  let searchStart = 0;
  let lastMatchTime = -1;

  for (const line of lines) {
    const lineWords = line.split(/\s+/).filter(Boolean);
    allLyricWords.push(...lineWords);

    const res = matchLine(lineWords, whisperWords, whisperNorm, searchStart, lastMatchTime);
    allMatched.push(...fixStretchedWords(res.matched));
    searchStart = res.searchStart;
    lastMatchTime = res.lastMatchTime;
  }

  const interpolated = interpolateMissing(allMatched, allLyricWords);

  const output: AlignedSyllable[] = [];
  let wordIdx = 0;

  for (let li = 0; li < lines.length; li++) {
    const lineWords = lines[li].split(/\s+/).filter(Boolean);

    for (const word of lineWords) {
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
          syllable: syl,
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
