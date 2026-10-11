import path from "path";
import crypto from "crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { parseUltrastarTxt, type ParsedUltrastar } from "./ultrastar";
import type { EditorNote } from "./editorNote";
import { DRAFTS_DIR, isInside } from "./safePath";
import { getSongsDir } from "./settings";
import { extractAudio } from "./ffmpeg";
import { AppError } from "@/app/lib/appError";

/** Same marker songFolder.ts drops into folders created by this app. */
const MARKER = ".ultrasongs";

export interface LibrarySong {
  /** Folder name inside SONGS_DIR. */
  folder: string;
  title: string;
  artist: string;
  hasVideo: boolean;
  /** Created by this app (carries the marker file). */
  ours: boolean;
}

/**
 * Ultrastar pitches are relative to C4 (0 = MIDI 60) in files made by other tools, while the
 * files this app writes carry absolute MIDI. Telling them apart by the median keeps both inside
 * the editor's range; 60 is five whole octaves, so scoring (which ignores octave) is unaffected.
 */
function pitchOffsetFor(notes: ParsedUltrastar["notes"]): number {
  const pitches = notes
    .filter((n) => n.type !== "-" && n.type !== "F")
    .map((n) => n.pitch)
    .sort((a, b) => a - b);
  if (pitches.length === 0) return 0;
  return pitches[Math.floor(pitches.length / 2)] < 30 ? 60 : 0;
}

/** Converts parsed Ultrastar notes (beats) to timeline-editor notes (seconds). */
export function ultrastarToEditorNotes(parsed: ParsedUltrastar): EditorNote[] {
  const beatsPerSec = (parsed.bpm / 60) * 4;
  const offset = pitchOffsetFor(parsed.notes);
  return parsed.notes
    .filter((n) => n.type !== "-")
    .map((n) => ({
      id: crypto.randomUUID(),
      syllable: n.syllable,
      startSec: parsed.gap / 1000 + n.startBeat / beatsPerSec,
      durationSec: Math.max(0.01, n.duration / beatsPerSec),
      pitch: n.pitch + offset,
      type: n.type as EditorNote["type"],
    }));
}

async function findTxt(dir: string): Promise<string | null> {
  const files = await readdir(dir);
  const txt = files.find((f) => f.toLowerCase().endsWith(".txt"));
  return txt ? path.join(dir, txt) : null;
}

const AUDIO_EXTS = new Set([".mp3", ".ogg", ".opus", ".m4a", ".wav", ".flac"]);
const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".avi", ".mov"]);

/** Lowercased name without extension, spaces or punctuation: "Sum41 - War .mp3" ≈ "Sum 41 - War.mp3". */
function looseKey(name: string): string {
  const ext = path.extname(name);
  return name.slice(0, name.length - ext.length).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") + ext.toLowerCase();
}

/**
 * Finds the file a #MP3/#VIDEO tag refers to. Real-world libraries often have tags that don't
 * match the file name exactly, so fall back to a loose name match and then to the only file of
 * the right kind in the folder.
 */
function resolveInFolder(dir: string, name: string | undefined, files: string[], exts: Set<string>): string | null {
  const kind = files.filter((f) => exts.has(path.extname(f).toLowerCase()));
  if (name?.trim()) {
    const base = path.basename(name.trim());
    const hit =
      kind.find((f) => f === base) ??
      kind.find((f) => f.toLowerCase() === base.toLowerCase()) ??
      kind.find((f) => looseKey(f) === looseKey(base));
    if (hit) return path.join(dir, hit);
  }
  return kind.length === 1 ? path.join(dir, kind[0]) : null;
}

/** Lists every song folder in SONGS_DIR that has a readable .txt. */
export async function listLibrary(): Promise<LibrarySong[]> {
  const songsDir = getSongsDir();
  if (!songsDir || !existsSync(songsDir)) return [];
  const entries = await readdir(songsDir, { withFileTypes: true });
  const songs: LibrarySong[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(songsDir, entry.name);
    try {
      const txtPath = await findTxt(dir);
      if (!txtPath) continue;
      const parsed = parseUltrastarTxt(await readFile(txtPath, "utf8"));
      songs.push({
        folder: entry.name,
        title: parsed.title || entry.name,
        artist: parsed.artist,
        hasVideo: !!parsed.videoFilename,
        ours: existsSync(path.join(dir, MARKER)),
      });
    } catch {
      // unreadable folder: skip
    }
  }

  return songs.sort((a, b) =>
    `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`, undefined, { sensitivity: "base" })
  );
}

/** Imports one song folder from SONGS_DIR as a draft (copies audio/video, never touches the source). */
export async function importFromLibrary(folder: string): Promise<string> {
  const songsDir = getSongsDir();
  if (!songsDir) throw new AppError("api.pickSongsFirst", undefined, 400);
  if (!folder || folder !== path.basename(folder)) throw new AppError("api.folderInvalid", undefined, 400);
  const dir = path.join(songsDir, folder);
  if (!isInside(songsDir, dir) || !existsSync(dir)) throw new AppError("api.folderNotFound", undefined, 404);

  const txtPath = await findTxt(dir);
  if (!txtPath) throw new AppError("api.folderNoTxt", undefined, 400);
  const parsed = parseUltrastarTxt(await readFile(txtPath, "utf8"));

  const files = await readdir(dir);
  const mp3Src = resolveInFolder(dir, parsed.mp3Filename, files, AUDIO_EXTS);
  if (!mp3Src) throw new AppError("api.audioTagMissing", { name: parsed.mp3Filename || "—" }, 404);
  const videoSrc = parsed.videoFilename ? resolveInFolder(dir, parsed.videoFilename, files, VIDEO_EXTS) : null;

  const id = crypto.randomUUID();
  const draftPath = path.join(DRAFTS_DIR, id);
  await mkdir(draftPath, { recursive: true });

  // The app expects mp3 audio; convert anything else (ogg, m4a…) on the way in.
  if (path.extname(mp3Src).toLowerCase() === ".mp3") await copyFile(mp3Src, path.join(draftPath, "audio.mp3"));
  else await extractAudio(mp3Src, path.join(draftPath, "audio.mp3"));
  let videoFilename: string | undefined;
  if (videoSrc) {
    videoFilename = "video" + (path.extname(videoSrc).toLowerCase() || ".mp4");
    await copyFile(videoSrc, path.join(draftPath, videoFilename));
  }

  const draft = {
    id,
    title: parsed.title,
    artist: parsed.artist,
    lyrics: "",
    savedAt: new Date().toISOString(),
    bpm: parsed.bpm,
    gap: parsed.gap,
    notes: ultrastarToEditorNotes(parsed),
    words: [],
    language: "",
    pauses: [],
    audioFilename: "audio.mp3",
    videoFilename,
  };
  await writeFile(path.join(draftPath, "draft.json"), JSON.stringify(draft));
  return id;
}
