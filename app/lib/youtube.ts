import { spawn } from "child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { resolvePython } from "./setup/paths";
import { AppError } from "@/app/lib/appError";

const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

/** Returns a normalised URL string if `raw` is a YouTube link, otherwise null. */
export function parseYoutubeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return ALLOWED_HOSTS.has(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Downloads a YouTube video (video+audio merged into mp4, ≤720p, H.264 when available)
 * to `outputPath` (must end in .mp4). Returns the video title.
 * Runs yt-dlp as `python -m yt_dlp`; override the interpreter with YTDLP_PYTHON.
 */
export function downloadYoutube(url: string, outputPath: string): Promise<string> {
  const python = process.env.YTDLP_PYTHON ?? resolvePython() ?? "python";
  const args = [
    "-m", "yt_dlp",
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--js-runtimes", "node",
    "--no-simulate",
    "--print", "%(title)s",
    "-f", "bv*[vcodec^=avc1][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/bv*[height<=720]+ba/b",
    "--merge-output-format", "mp4",
    "--ffmpeg-location", ffmpegInstaller.path,
    "-o", outputPath,
    "--",
    url,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(python, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) =>
      reject(new AppError("api.ytdlpMissing", { python, detail: err.message }))
    );
    proc.on("close", (code) => {
      if (code === 0) return resolve(stdout.trim().split("\n")[0] ?? "");
      const detail = stderr.trim().split("\n").pop() ?? `exit code ${code}`;
      reject(new AppError("api.ytdlpFailed", { detail }));
    });
  });
}
