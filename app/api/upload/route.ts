import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import { isSupportedFile, isVideoFile, extractAudio, extractCover, coverPathFor } from "@/app/lib/ffmpeg";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const TMP_DIR = path.resolve(process.env.TMP_DIR ?? "./tmp");
async function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) {
    await mkdir(TMP_DIR, { recursive: true });
  }
}

export async function POST(request: NextRequest) {
  let rawPath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const videoFile = formData.get("video");
    const coverFile = formData.get("cover");

    if ((!file || typeof file === "string") && (!videoFile || typeof videoFile === "string")) {
      return apiError("api.noFile", 400);
    }

    await ensureTmpDir();

    // ── Video-only upload (no audio) ──────────────────────────────────────────
    if ((!file || typeof file === "string") && videoFile && typeof videoFile !== "string") {
      const videoId = crypto.randomUUID();
      const videoExt = path.extname(videoFile.name).toLowerCase() || ".mp4";
      const videoPath = path.join(TMP_DIR, `${videoId}-video${videoExt}`);
      await writeFile(videoPath, Buffer.from(await videoFile.arrayBuffer()));
      return NextResponse.json({ videoPath });
    }

    // ── Audio upload (with optional video) ───────────────────────────────────
    if (!file || typeof file === "string") {
      return apiError("api.noAudioFile", 400);
    }

    if (!isSupportedFile(file.name)) {
      return apiError("api.unsupportedType", 400, { ext: path.extname(file.name) });
    }

    const id = crypto.randomUUID();
    const rawExt = path.extname(file.name).toLowerCase();
    rawPath = path.join(TMP_DIR, `${id}-raw${rawExt}`);
    const mp3Path = path.join(TMP_DIR, `${id}.mp3`);

    await writeFile(rawPath, Buffer.from(await file.arrayBuffer()));
    await extractAudio(rawPath, mp3Path);

    let videoPath: string | undefined;

    // If the uploaded file is a video, keep it as the video track
    if (isVideoFile(file.name)) {
      videoPath = path.join(TMP_DIR, `${id}-video${rawExt}`);
      await writeFile(videoPath, await readFile(rawPath));
    }

    // Album art embedded in an audio file. The original is deleted below, so this is the last
    // chance to read it. (In a video file the first video stream is the picture, not a cover.)
    if (!isVideoFile(file.name)) await extractCover(rawPath, coverPathFor(mp3Path));

    // A cover the user picked wins over the embedded one
    if (coverFile && typeof coverFile !== "string" && IMAGE_EXTS.has(path.extname(coverFile.name).toLowerCase())) {
      const coverRaw = path.join(TMP_DIR, `${id}-cover${path.extname(coverFile.name).toLowerCase()}`);
      await writeFile(coverRaw, Buffer.from(await coverFile.arrayBuffer()));
      await extractCover(coverRaw, coverPathFor(mp3Path));
      await unlink(coverRaw).catch(() => null);
    }

    await unlink(rawPath);
    rawPath = null;

    // Explicit video upload overrides the video derived from the audio file
    if (videoFile && typeof videoFile !== "string") {
      const videoExt = path.extname(videoFile.name).toLowerCase() || ".mp4";
      videoPath = path.join(TMP_DIR, `${id}-video${videoExt}`);
      await writeFile(videoPath, Buffer.from(await videoFile.arrayBuffer()));
    }
    return NextResponse.json({ id, mp3: mp3Path, ...(videoPath ? { videoPath } : {}) });
  } catch (err) {
    if (rawPath) await unlink(rawPath).catch(() => null);
    console.error("[upload]", err);
    return apiFailure(err, "api.uploadFailed", 500);
  }
}
