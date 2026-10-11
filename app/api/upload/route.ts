import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import { isSupportedFile, isVideoFile, extractAudio } from "@/app/lib/ffmpeg";

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
