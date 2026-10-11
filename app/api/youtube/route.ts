import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { mkdir, unlink } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { extractAudio } from "@/app/lib/ffmpeg";
import { TMP_DIR } from "@/app/lib/safePath";
import { downloadYoutube, parseYoutubeUrl } from "@/app/lib/youtube";
import { YOUTUBE_ENABLED } from "@/app/lib/features";

export async function POST(request: NextRequest) {
  if (!YOUTUBE_ENABLED) {
    return apiError("api.notFound", 404);
  }

  let videoPath: string | null = null;
  let ok = false;

  try {
    const body = await request.json().catch(() => ({}));
    const url = parseYoutubeUrl(body?.url);
    if (!url) {
      return apiError("api.youtubeInvalid", 400);
    }

    await mkdir(TMP_DIR, { recursive: true });

    const id = crypto.randomUUID();
    videoPath = path.join(TMP_DIR, `${id}-video.mp4`);
    const mp3Path = path.join(TMP_DIR, `${id}.mp3`);

    const title = await downloadYoutube(url, videoPath);
    await extractAudio(videoPath, mp3Path);

    ok = true;
    return NextResponse.json({ id, mp3: mp3Path, videoPath, title });
  } catch (err) {
    console.error("[youtube]", err);
    return apiFailure(err, "youtube.failed", 500);
  } finally {
    if (!ok && videoPath) await unlink(videoPath).catch(() => null);
  }
}
