import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import MusicTempo from "music-tempo";
import { existsSync } from "fs";
import type { EditorNote, NoteType } from "./editorNote";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface UltrastarNote {
  type: NoteType | "-";
  startBeat: number;
  duration: number;
  pitch: number;
  syllable: string;
}

export interface UltrastarMeta {
  title: string;
  artist: string;
  mp3: string;
  bpm: number;
  gap: number;
  video?: string;
}

/**
 * Converts milliseconds to Ultrastar beats.
 * beat = ((ms - GAP) / 1000) * (BPM / 60) * 4
 */
export function msToBeats(ms: number, bpm: number, gap: number): number {
  return Math.round(((ms - gap) / 1000) * (bpm / 60) * 4);
}

/**
 * Silence between two notes (seconds) from which a new lyric line starts. Editor notes carry no
 * line information, so breaks are inferred from pauses; 0.4 s matched the lyric line count of
 * the songs checked.
 */
const LINE_BREAK_GAP_SEC = 0.4;

/**
 * Converts timeline-editor notes (seconds) to Ultrastar notes (beats), keeping notes from
 * overlapping and inserting a line break ("-") wherever a pause of `breakGapSec` or more separates
 * two notes.
 */
export function editorNotesToUltrastar(
  notes: EditorNote[],
  bpm: number,
  gap: number,
  breakGapSec = LINE_BREAK_GAP_SEC
): UltrastarNote[] {
  const out: UltrastarNote[] = [];
  let prevEnd = -1;
  let prevEndSec = -1;
  for (const en of notes) {
    const startBeat = msToBeats(en.startSec * 1000, bpm, gap);
    const endBeat = msToBeats((en.startSec + en.durationSec) * 1000, bpm, gap);
    const duration = Math.max(1, endBeat - startBeat);

    if (prevEnd >= 0 && en.startSec - prevEndSec >= breakGapSec) {
      // Same placement as the auto mode: 4 beats before the next note, never before the last one ends.
      const breakBeat = Math.max(prevEnd + 1, startBeat - 4);
      out.push({ type: "-", startBeat: breakBeat, duration: 0, pitch: 0, syllable: "" });
      prevEnd = breakBeat;
    }

    const adjStart = prevEnd >= 0 ? Math.max(startBeat, prevEnd + 1) : startBeat;
    prevEndSec = en.startSec + en.durationSec;
    out.push({ type: en.type, startBeat: adjStart, duration, pitch: en.pitch, syllable: en.syllable });
    prevEnd = adjStart + duration;
  }
  return out;
}

export function buildUltrastarTxt(notes: UltrastarNote[], meta: UltrastarMeta): string {
  const headerLines = [
    `#TITLE:${meta.title}`,
    `#ARTIST:${meta.artist}`,
    `#MP3:${meta.mp3}`,
    ...(meta.video ? [`#VIDEO:${meta.video}`] : []),
    `#BPM:${meta.bpm.toFixed(2)}`,
    `#GAP:${Math.round(meta.gap)}`,
    "",
  ];
  const header = headerLines.join("\n");

  const body = notes
    .map((n) =>
      n.type === "-"
        ? `- ${n.startBeat}`
        : `${n.type} ${n.startBeat} ${n.duration} ${n.pitch} ${n.syllable}`
    )
    .join("\n");

  return header + body + "\nE\n";
}

/** Extracts float32 mono PCM from an mp3 via FFmpeg, returns samples at the given sampleRate. */
function extractPcm(mp3Path: string, sampleRate = 44100): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    ffmpeg(mp3Path)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(sampleRate)
      .audioCodec("pcm_f32le")
      .format("f32le")
      .on("error", reject)
      .pipe()
      .on("data", (chunk: Buffer) => chunks.push(chunk))
      .on("end", () => {
        const buf = Buffer.concat(chunks);
        const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        resolve(floats);
      })
      .on("error", reject);
  });
}

/** BPM used when tempo detection fails outright. */
const FALLBACK_BPM = 120;

/** Lowest BPM we emit — UltraStar beats are 1/4 of a musical beat, so 300 BPM = 20 steps/s (50 ms). */
const MIN_ULTRASTAR_BPM = 300;

/**
 * UltraStar's BPM is only a time unit, so doubling it (and the beat counts with it)
 * leaves the timing unchanged while making note positions finer. At a detected 120 BPM
 * the grid is 125 ms wide, coarser than the ~50 ms Whisper/crepe can resolve.
 */
export function toFineBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return bpm;
  let out = bpm;
  while (out < MIN_ULTRASTAR_BPM) out *= 2;
  return out;
}

/**
 * Detects BPM from an mp3 file, scaled by powers of two to a fine UltraStar grid (see toFineBpm).
 * Returns { bpm, beats } where beats are timestamps in seconds.
 */
export async function detectBpm(mp3Path: string): Promise<{ bpm: number; beats: number[] }> {
  // The full mix first; some tracks only yield a tempo from the Demucs vocals stem.
  const vocalsPath = mp3Path.replace(/\.mp3$/i, "_vocals.mp3");
  const candidates = vocalsPath !== mp3Path && existsSync(vocalsPath) ? [mp3Path, vocalsPath] : [mp3Path];

  for (const file of candidates) {
    const samples = await extractPcm(file);
    // music-tempo throws bare strings ("Tempo extraction failed", "Fail to find peaks"…) on
    // material it can't track. Retry with a looser peak threshold before moving on.
    const attempts: Record<string, number>[] = [{}, { peakThreshold: 0.15 }, { peakThreshold: 0.05, decayRate: 0.9 }];
    for (const opts of attempts) {
      try {
        // MusicTempo expects a plain Array or Float32Array of non-interleaved mono float32 PCM
        const mt = new MusicTempo(samples, opts);
        const tempo = parseFloat(String(mt.tempo));
        if (Number.isFinite(tempo) && tempo > 0) return { bpm: toFineBpm(tempo), beats: mt.beats };
      } catch {
        // try next set of options
      }
    }
  }

  // BPM is only a time unit in UltraStar (see toFineBpm), so a default keeps note timing correct.
  console.warn("[detectBpm] tempo detection failed, falling back to", FALLBACK_BPM, "BPM");
  return { bpm: toFineBpm(FALLBACK_BPM), beats: [] };
}


export interface ParsedUltrastar {
  title: string;
  artist: string;
  bpm: number;
  gap: number;
  mp3Filename: string;
  videoFilename?: string;
  notes: UltrastarNote[];
}

/** Parses an Ultrastar .txt file into structured data. */
export function parseUltrastarTxt(content: string): ParsedUltrastar {
  const lines = content.split(/\r?\n/);
  const meta: Record<string, string> = {};
  const notes: UltrastarNote[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      const colon = trimmed.indexOf(":");
      if (colon > 0) {
        meta[trimmed.slice(1, colon).toUpperCase()] = trimmed.slice(colon + 1).trim();
      }
    } else if (/^[:*FRG] /.test(trimmed)) {
      const parts = trimmed.split(" ");
      if (parts.length >= 4) {
        notes.push({
          type: parts[0] as NoteType,
          startBeat: parseInt(parts[1]),
          duration: parseInt(parts[2]),
          pitch: parseInt(parts[3]),
          syllable: parts.slice(4).join(" "),
        });
      }
    } else if (trimmed.startsWith("- ")) {
      notes.push({ type: "-", startBeat: parseInt(trimmed.slice(2)), duration: 0, pitch: 0, syllable: "" });
    }
  }

  return {
    title: meta.TITLE ?? "",
    artist: meta.ARTIST ?? "",
    bpm: parseFloat((meta.BPM ?? "120").replace(",", ".")),
    gap: parseInt(meta.GAP ?? "0"),
    mp3Filename: meta.MP3 ?? "",
    videoFilename: meta.VIDEO,
    notes,
  };
}
