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
}
