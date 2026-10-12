import path from "path";
import { copyFile, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { buildUltrastarTxt, type UltrastarMeta, type UltrastarNote } from "./ultrastar";
import { isInside } from "./safePath";
import { AppError } from "@/app/lib/appError";
import { linkDraft, linkedFolder } from "./draftLink";

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
  /** Draft this song comes from: it gets linked to the folder (see draftLink.ts). */
  draftId?: string;
}

/** `#TAG:value` lines at the top of an Ultrastar .txt (stops at the first note or line break). */
function headerLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) out.push(line);
    else if (line.trim() === "") continue;
    else break;
  }
  return out;
}

function tagValue(lines: string[], tag: string): string | undefined {
  const re = new RegExp(`^#${tag}:(.*)$`, "i");
  for (const l of lines) {
    const m = re.exec(l);
    if (m) return m[1].trim();
  }
  return undefined;
}

async function firstTxt(dir: string): Promise<string | null> {
  const hit = (await readdir(dir)).find((f) => f.toLowerCase().endsWith(".txt"));
  return hit ? path.join(dir, hit) : null;
}

/**
 * Updates a song folder made elsewhere (it has no marker) without recreating it: only its .txt is
 * rewritten, in place. Every other header tag (#COVER, #BACKGROUND, #YEAR, …) and every other file
 * stays as it was, and the original .txt is kept next to it as `<name>.txt.bak` the first time.
 * Returns false when the folder has no .txt to update.
 */
async function updateForeignFolder(
  dir: string,
  input: Pick<SaveSongInput, "title" | "artist" | "notes" | "bpm" | "gap">
): Promise<string | null> {
  const txtPath = await firstTxt(dir);
  if (!txtPath) return null;
  const original = await readFile(txtPath, "utf8");

  const built = buildUltrastarTxt(input.notes, {
    title: input.title, artist: input.artist, mp3: "", bpm: input.bpm, gap: input.gap,
  });
  const builtLines = built.split("\n");
  const bodyStart = builtLines.findIndex((l) => l.trim() !== "" && !l.startsWith("#"));
  const body = builtLines.slice(bodyStart).join("\n");

  // Values we own replace the originals; everything else in the header is carried over untouched.
  const managed = new Map<string, string>([
    ["TITLE", input.title],
    ["ARTIST", input.artist],
    ["BPM", input.bpm.toFixed(2)],
    ["GAP", String(Math.round(input.gap))],
    ["ENCODING", "UTF8"],
  ]);
  const seen = new Set<string>();
  const header = headerLines(original).map((line) => {
    const m = /^#([A-Za-z0-9_]+):/.exec(line);
    const tag = m?.[1].toUpperCase();
    if (tag && managed.has(tag)) {
      seen.add(tag);
      return `#${tag}:${managed.get(tag)}`;
    }
    return line;
  });
  for (const [tag, value] of managed) if (!seen.has(tag)) header.push(`#${tag}:${value}`);

  const backup = `${txtPath}.bak`;
  if (!existsSync(backup)) await copyFile(txtPath, backup);
  const text = header.join("\n") + "\n" + body;
  await writeFile(txtPath, text, "utf8");
  return text;
}

/**
 * Writes `<songsDir>/<Artist> - <Title>/` with the .txt, mp3 and (optionally) video,
 * named after the song so Ultrastar lists it cleanly. Returns the folder path.
 *
 * A folder this app did not create is never replaced, with one exception: the draft was imported
 * from it (or it holds the same title and artist), which means the user is exporting their edits of
 * that very song back. Then only its .txt is updated, see updateForeignFolder.
 */
export async function saveSongFolder(input: SaveSongInput): Promise<string> {
  const { songsDir, title, artist, notes, bpm, gap, mp3Path, videoPath, draftId } = input;
  const base = `${safeName(artist)} - ${safeName(title)}`;
  const dir = path.join(songsDir, base);
  if (!isInside(songsDir, dir)) throw new AppError("api.songNameInvalid", undefined, 400);

  // The folder the draft was imported from, even if the title was edited since
  const linked = draftId ? await linkedFolder(draftId) : null;
  if (linked && linked === path.basename(linked)) {
    const linkedDir = path.join(songsDir, linked);
    if (isInside(songsDir, linkedDir) && existsSync(linkedDir) && !existsSync(path.join(linkedDir, MARKER))) {
      const text = await updateForeignFolder(linkedDir, input);
      if (text !== null) {
        if (draftId) await linkDraft(draftId, linked, text);
        return linkedDir;
      }
    }
  }

  if (existsSync(dir) && !existsSync(path.join(dir, MARKER))) {
    // Same song, made elsewhere (e.g. imported before drafts remembered their folder)
    const txtPath = await firstTxt(dir);
    if (txtPath) {
      const header = headerLines(await readFile(txtPath, "utf8"));
      const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.trim().toLowerCase();
      if (same(tagValue(header, "TITLE"), title) && same(tagValue(header, "ARTIST"), artist)) {
        const text = await updateForeignFolder(dir, input);
        if (text !== null) {
          if (draftId) await linkDraft(draftId, base, text);
          return dir;
        }
      }
    }
    throw new AppError("api.folderExists", { name: base }, 409);
  }

  const mp3Name = `${base}.mp3`;
  const videoName = videoPath ? `${base}${path.extname(videoPath) || ".mp4"}` : undefined;
  const meta: UltrastarMeta = { title, artist, mp3: mp3Name, bpm, gap, video: videoName };

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, MARKER), "", "utf8");
  const txt = buildUltrastarTxt(notes, meta);
  await writeFile(path.join(dir, `${base}.txt`), txt, "utf8");
  await copyFile(mp3Path, path.join(dir, mp3Name));
  if (videoPath && videoName) await copyFile(videoPath, path.join(dir, videoName));
  if (draftId) await linkDraft(draftId, base, txt);
  return dir;
}
