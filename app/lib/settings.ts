import path from "path";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { APP_HOME } from "./setup/paths";
import { AppError } from "@/app/lib/appError";

const SETTINGS_FILE = path.join(APP_HOME, "settings.json");

interface Settings {
  /** Ultrastar `Songs` folder finished songs are written to. */
  songsDir?: string;
}

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Settings;
  } catch {
    return {};
  }
}

/** Songs folder: the SONGS_DIR env var wins (dev / .env.local), else the one chosen in the app. */
export function getSongsDir(): string | null {
  const dir = process.env.SONGS_DIR || readSettings().songsDir;
  return dir ? path.resolve(dir) : null;
}

export function songsDirIsLocked(): boolean {
  return !!process.env.SONGS_DIR;
}

/** Persists the chosen Songs folder. Throws if it doesn't exist or isn't a directory. */
export async function setSongsDir(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  if (!existsSync(resolved)) throw new AppError("api.folderMissing", undefined, 400);
  await mkdir(APP_HOME, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify({ ...readSettings(), songsDir: resolved }, null, 2));
  return resolved;
}
