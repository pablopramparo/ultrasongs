import { NextRequest } from "next/server";
import { apiError } from "@/app/lib/apiResponse";
import { existsSync } from "fs";
import path from "path";
import { resolveAllowed, serveFile } from "@/app/lib/safePath";

export async function GET(request: NextRequest) {
  const videoParam = request.nextUrl.searchParams.get("path");

  if (!videoParam) {
    return apiError("api.missingParam", 400, { name: "path" });
  }

  const resolved = resolveAllowed(videoParam);
  if (!resolved) {
    return apiError("api.invalidPath", 403);
  }

  if (!existsSync(resolved)) {
    return apiError("api.fileNotFound", 404);
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4";

  return serveFile(request, resolved, contentType);
}
