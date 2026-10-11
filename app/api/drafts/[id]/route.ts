import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { readFile, writeFile, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { draftDir } from "@/app/lib/safePath";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const dir = draftDir(id);
    if (!dir) return apiError("api.invalidDraftId", 400);
    const jsonPath = path.join(dir, "draft.json");
    if (!existsSync(jsonPath)) {
      return apiError("api.draftNotFound", 404);
    }
    const data = JSON.parse(await readFile(jsonPath, "utf-8"));
    return NextResponse.json({
      ...data,
      mp3: path.join(dir, data.audioFilename),
      videoPath: data.videoFilename ? path.join(dir, data.videoFilename) : undefined,
      vocalsPath: data.vocalsFilename ? path.join(dir, data.vocalsFilename) : undefined,
      accompanimentPath: data.accompanimentFilename ? path.join(dir, data.accompanimentFilename) : undefined,
    });
  } catch (err) {
    return apiFailure(err, "api.genericFailed", 500);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const dir = draftDir(id);
    if (!dir) return apiError("api.invalidDraftId", 400);
    const jsonPath = path.join(dir, "draft.json");
    if (!existsSync(jsonPath)) {
      return apiError("api.draftNotFound", 404);
    }
    const existing = JSON.parse(await readFile(jsonPath, "utf-8"));
    const updates = await req.json();
    const merged = { ...existing, ...updates, savedAt: new Date().toISOString() };
    await writeFile(jsonPath, JSON.stringify(merged));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiFailure(err, "api.genericFailed", 500);
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const dir = draftDir(id);
    if (!dir) return apiError("api.invalidDraftId", 400);
    if (!existsSync(dir)) {
      return apiError("api.draftNotFound", 404);
    }
    await rm(dir, { recursive: true, force: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiFailure(err, "api.genericFailed", 500);
  }
}
