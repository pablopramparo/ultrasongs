import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/app/lib/apiResponse";
import { existsSync } from "fs";
import { resolveAllowed, serveFile } from "@/app/lib/safePath";

export async function GET(request: NextRequest) {
  const mp3 = request.nextUrl.searchParams.get("mp3");

  if (!mp3) {
    return apiError("api.missingParam", 400, { name: "mp3" });
  }

  const resolved = resolveAllowed(mp3);
  if (!resolved) {
    return apiError("api.invalidPath", 403);
  }

  if (!existsSync(resolved)) {
    return apiError("api.fileNotFound", 404);
  }

  return serveFile(request, resolved, "audio/mpeg");
}
