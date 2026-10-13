import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { writeFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import { resolveAllowed, serveFile, TMP_DIR } from "@/app/lib/safePath";
import { coverPathFor, extractCover } from "@/app/lib/ffmpeg";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** The cover that travels with an mp3 (embedded art, or the one the user replaced it with). */
export async function GET(request: NextRequest) {
  const mp3 = resolveAllowed(request.nextUrl.searchParams.get("mp3"));
  if (!mp3) return apiError("api.invalidPath", 403);
  const cover = coverPathFor(mp3);
  if (!existsSync(cover)) return apiError("api.fileNotFound", 404);
  return serveFile(request, cover, "image/jpeg");
}

/** Replaces the cover of an already uploaded mp3 with an image file (jpg, png or webp). */
export async function POST(request: NextRequest) {
  let rawPath: string | null = null;
  try {
    const form = await request.formData();
    const mp3 = resolveAllowed(form.get("mp3"));
    const file = form.get("file");
    if (!mp3 || !existsSync(mp3)) return apiError("api.invalidPath", 403);
    if (!file || typeof file === "string") return apiError("api.noFile", 400);

    const ext = path.extname(file.name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return apiError("api.unsupportedType", 400, { ext });

    rawPath = path.join(TMP_DIR, `${crypto.randomUUID()}-cover${ext}`);
    await writeFile(rawPath, Buffer.from(await file.arrayBuffer()));
    // Re-encoded to a ≤1000 px JPEG, which is what Ultrastar expects next to the .txt
    if (!(await extractCover(rawPath, coverPathFor(mp3)))) return apiError("api.unsupportedType", 400, { ext });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiFailure(err, "api.genericFailed", 500);
  } finally {
    if (rawPath) await unlink(rawPath).catch(() => null);
  }
}
