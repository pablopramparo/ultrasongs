import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { draftDir } from "@/app/lib/safePath";
import { editorNotesToUltrastar } from "@/app/lib/ultrastar";
import { saveSongFolder } from "@/app/lib/songFolder";
import { getSongsDir } from "@/app/lib/settings";

/** Writes a saved draft into SONGS_DIR as an Ultrastar song folder, using its stored notes. */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const songsDir = getSongsDir();
    if (!songsDir) {
      return apiError("api.pickSongsFirst", 400);
    }
    const { id } = await ctx.params;
    const dir = draftDir(id);
    if (!dir) return apiError("api.invalidDraftId", 400);
    const jsonPath = path.join(dir, "draft.json");
    if (!existsSync(jsonPath)) {
      return apiError("api.draftNotFound", 404);
    }

    const d = JSON.parse(await readFile(jsonPath, "utf-8"));
    const mp3Path = path.join(dir, d.audioFilename);
    if (!existsSync(mp3Path)) {
      return apiError("api.draftNoAudio", 404);
    }
    const videoPath = d.videoFilename ? path.join(dir, d.videoFilename) : undefined;

    const saved = await saveSongFolder({
      songsDir,
      title: d.title,
      artist: d.artist,
      notes: editorNotesToUltrastar(d.notes, d.bpm, d.gap),
      bpm: d.bpm,
      gap: d.gap,
      mp3Path,
      videoPath: videoPath && existsSync(videoPath) ? videoPath : undefined,
    });
    return NextResponse.json({ dir: saved });
  } catch (err) {
    return apiFailure(err, "api.genericFailed", 500);
  }
}
