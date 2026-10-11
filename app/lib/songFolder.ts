import path from "path";
import { copyFile, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { buildUltrastarTxt, type UltrastarMeta, type UltrastarNote } from "./ultrastar";
import { isInside } from "./safePath";
import { AppError } from "@/app/lib/appError";

/** Dropped into every folder we create, so we never overwrite songs made elsewhere. */
const MARKER = ".ultrasongs";

/** Strips characters Windows/macOS/Linux don't allow in file names. */
function safeName(s: string): string {
  const cleaned = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return cleaned || "song";
}

interface SaveSongInput {
  songsDir: string;
  title: string;
  artist: string;
  notes: UltrastarNote[];
  bpm: number;
  gap: number;
  mp3Path: string;
  videoPath?: string;
}

/**
 * Writes `<songsDir>/<Artist> - <Title>/` with the .txt, mp3 and (optionally) video,
 * named after the song so Ultrastar lists it cleanly. Returns the folder path.
 */
export async function saveSongFolder(input: SaveSongInput): Promise<string> {
  const { songsDir, title, artist, notes, bpm, gap, mp3Path, videoPath } = input;
  const base = `${safeName(artist)} - ${safeName(title)}`;
  const dir = path.join(songsDir, base);
  if (!isInside(songsDir, dir)) throw new AppError("api.songNameInvalid", undefined, 400);

  const mp3Name = `${base}.mp3`;
  const videoName = videoPath ? `${base}${path.extname(videoPath) || ".mp4"}` : undefined;
  const meta: UltrastarMeta = { title, artist, mp3: mp3Name, bpm, gap, video: videoName };

  if (existsSync(dir) && !existsSync(path.join(dir, MARKER))) {
    throw new AppError("api.folderExists", { name: base }, 409);
  }

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, MARKER), "", "utf8");
  await writeFile(path.join(dir, `${base}.txt`), buildUltrastarTxt(notes, meta), "utf8");
  await copyFile(mp3Path, path.join(dir, mp3Name));
  if (videoPath && videoName) await copyFile(videoPath, path.join(dir, videoName));
  return dir;
}
