import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { readdir, readFile, writeFile, mkdir, copyFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import { coverPathFor } from "@/app/lib/ffmpeg";
import { DRAFTS_DIR, draftDir, resolveAllowed } from "@/app/lib/safePath";

async function ensureDraftsDir() {
  if (!existsSync(DRAFTS_DIR)) await mkdir(DRAFTS_DIR, { recursive: true });
}

export async function GET() {
  try {
    await ensureDraftsDir();
    const entries = await readdir(DRAFTS_DIR, { withFileTypes: true });
    const drafts = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const jsonPath = path.join(DRAFTS_DIR, entry.name, "draft.json");
      if (!existsSync(jsonPath)) continue;
      try {
        const { id, title, artist, savedAt, videoFilename } = JSON.parse(
          await readFile(jsonPath, "utf-8")
        );
        drafts.push({ id, title, artist, savedAt, hasVideo: !!videoFilename });
      } catch { /* skip corrupt draft */ }
    }

    drafts.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    return NextResponse.json(drafts);
  } catch (err) {
    return apiFailure(err, "api.genericFailed", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDraftsDir();
    const body = await request.json();
    const {
      draftId, title, artist, lyrics, bpm, gap, notes, words, language, pauses,
      mp3, videoPath, vocalsPath, accompanimentPath,
    } = body;

    const id: string = draftId ?? crypto.randomUUID();
    const dir = draftDir(id);
    if (!dir) return apiError("api.invalidDraftId", 400);

    // Source files must live inside TMP_DIR / DRAFTS_DIR — never copy arbitrary client paths.
    const mp3Src = resolveAllowed(mp3);
    const videoSrc = resolveAllowed(videoPath);
    const vocalsSrc = resolveAllowed(vocalsPath);
    const accompanimentSrc = resolveAllowed(accompanimentPath);

    await mkdir(dir, { recursive: true });

    // Saving over an existing draft passes the draft's own files as sources — skip self-copies.
    const copyInto = async (src: string, name: string) => {
      const dest = path.join(dir, name);
      if (path.resolve(src) !== dest) await copyFile(src, dest);
    };

    const audioFilename = "audio.mp3";
    if (mp3Src && existsSync(mp3Src)) {
      await copyInto(mp3Src, audioFilename);
      // The cover lives next to the mp3 (see coverPathFor)
      const coverSrc = coverPathFor(mp3Src);
      if (existsSync(coverSrc)) await copyInto(coverSrc, coverPathFor(audioFilename));
    }

    let videoFilename: string | undefined;
    if (videoSrc && existsSync(videoSrc)) {
      videoFilename = "video" + path.extname(videoSrc).toLowerCase();
      await copyInto(videoSrc, videoFilename);
    }

    let vocalsFilename: string | undefined;
    if (vocalsSrc && existsSync(vocalsSrc)) {
      vocalsFilename = "vocals.mp3";
      await copyInto(vocalsSrc, vocalsFilename);
    }

    let accompanimentFilename: string | undefined;
    if (accompanimentSrc && existsSync(accompanimentSrc)) {
      accompanimentFilename = "accompaniment.mp3";
      await copyInto(accompanimentSrc, accompanimentFilename);
    }

    // Rewriting an existing draft keeps the Songs folder it is linked to (draftLink.ts)
    let link: { songFolder?: string; syncedHash?: string } = {};
    const existingJson = path.join(dir, "draft.json");
    if (existsSync(existingJson)) {
      try {
        const prev = JSON.parse(await readFile(existingJson, "utf-8"));
        if (prev.songFolder) link = { songFolder: prev.songFolder, syncedHash: prev.syncedHash };
      } catch { /* unreadable: nothing to keep */ }
    }

    const draft = {
      id, title, artist, lyrics: lyrics ?? "", savedAt: new Date().toISOString(),
      bpm, gap, notes, words, language, pauses: pauses ?? [],
      audioFilename, videoFilename, vocalsFilename, accompanimentFilename,
      ...link,
    };

    await writeFile(path.join(dir, "draft.json"), JSON.stringify(draft));
    return NextResponse.json({ id });
  } catch (err) {
    return apiFailure(err, "api.genericFailed", 500);
  }
}
