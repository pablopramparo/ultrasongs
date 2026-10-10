import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import MusicTempo from "music-tempo";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface UltrastarNote {
  type: ":" | "*" | "-";
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
  const samples = await extractPcm(mp3Path);
  // MusicTempo expects a plain Array or Float32Array of non-interleaved mono float32 PCM
  const mt = new MusicTempo(samples);
  return { bpm: toFineBpm(parseFloat(String(mt.tempo))), beats: mt.beats };
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
    } else if (trimmed.startsWith(": ") || trimmed.startsWith("* ")) {
      const parts = trimmed.split(" ");
      if (parts.length >= 4) {
        notes.push({
          type: parts[0] as ":" | "*",
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
