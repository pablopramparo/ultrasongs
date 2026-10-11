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
