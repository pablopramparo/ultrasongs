import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { existsSync } from "fs";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".mov", ".avi"]);
const AUDIO_EXTS = new Set([".mp3", ".ogg", ".flac", ".wav", ".m4a"]);

export function isSupportedFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext);
}

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTS.has(path.extname(filename).toLowerCase());
}

/** The cover image that travels next to an mp3: `<name>.mp3` → `<name>.jpg`. */
export function coverPathFor(mp3Path: string): string {
  return mp3Path.replace(/\.mp3$/i, "") + ".jpg";
}

/**
 * Writes the album art embedded in an audio file as a JPEG (≤1000 px wide).
 * Returns false (and leaves no file) when the file has none.
 */
export function extractCover(inputPath: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .outputOptions(["-an", "-frames:v", "1", "-vf", "scale='min(1000,iw)':-2", "-q:v", "3"])
      .output(outputPath)
      .on("end", () => resolve(existsSync(outputPath)))
      .on("error", () => resolve(false))
      .run();
  });
}

/** Converts any audio/video file to mono 128kbps mp3. Returns output path. */
export function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioBitrate("128k")
      .audioCodec("libmp3lame")
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}
