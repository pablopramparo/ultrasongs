import crypto from "crypto";
import path from "path";
import { readdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { DRAFTS_DIR, draftDir } from "./safePath";

/**
 * A draft remembers the Songs folder it was exported to (or imported from) and a hash of that
 * folder's .txt at that moment. Opening the song from the library can then reopen the draft that
 * has the processing results, and tell whether the .txt was changed outside the app since.
 */
export interface DraftLink {
  id: string;
  syncedHash?: string;
  savedAt: string;
}

/** Content hash that ignores line-ending style and trailing whitespace. */
export function hashSongText(text: string): string {
  return crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n").trimEnd()).digest("hex");
}

/** folder name → the draft linked to it (the most recently saved one if several claim it). */
export async function readDraftLinks(): Promise<Map<string, DraftLink>> {
  const links = new Map<string, DraftLink>();
  if (!existsSync(DRAFTS_DIR)) return links;
  for (const entry of await readdir(DRAFTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(DRAFTS_DIR, entry.name, "draft.json");
    if (!existsSync(jsonPath)) continue;
    try {
      const d = JSON.parse(await readFile(jsonPath, "utf-8"));
      if (typeof d.songFolder !== "string" || !d.songFolder) continue;
      const prev = links.get(d.songFolder);
      if (!prev || new Date(d.savedAt).getTime() > new Date(prev.savedAt).getTime()) {
        links.set(d.songFolder, { id: d.id, syncedHash: d.syncedHash, savedAt: d.savedAt });
      }
    } catch {
      /* corrupt draft: skip */
    }
  }
  return links;
}

/** Stops every draft except `exceptId` from claiming `folder`: one folder, one draft. */
export async function releaseFolder(folder: string, exceptId: string): Promise<void> {
  if (!existsSync(DRAFTS_DIR)) return;
  for (const entry of await readdir(DRAFTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === exceptId) continue;
    const jsonPath = path.join(DRAFTS_DIR, entry.name, "draft.json");
    if (!existsSync(jsonPath)) continue;
    try {
      const d = JSON.parse(await readFile(jsonPath, "utf-8"));
      if (d.songFolder === folder) {
        delete d.songFolder;
        delete d.syncedHash;
        await writeFile(jsonPath, JSON.stringify(d));
      }
    } catch {
      /* skip */
    }
  }
}

/** Records that `draftId` matches the .txt `txt` written to / read from `folder`. */
export async function linkDraft(draftId: string, folder: string, txt: string): Promise<void> {
  const dir = draftDir(draftId);
  if (!dir) return;
  const jsonPath = path.join(dir, "draft.json");
  if (!existsSync(jsonPath)) return;
  const draft = JSON.parse(await readFile(jsonPath, "utf-8"));
  await writeFile(jsonPath, JSON.stringify({ ...draft, songFolder: folder, syncedHash: hashSongText(txt) }));
  await releaseFolder(folder, draftId);
}
