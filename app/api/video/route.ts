import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import path from "path";
import { resolveAllowed, serveFile } from "@/app/lib/safePath";

export async function GET(request: NextRequest) {
  const videoParam = request.nextUrl.searchParams.get("path");

  if (!videoParam) {
    return NextResponse.json({ message: "Missing path param" }, { status: 400 });
  }

  const resolved = resolveAllowed(videoParam);
  if (!resolved) {
    return NextResponse.json({ message: "Invalid path" }, { status: 403 });
  }

  if (!existsSync(resolved)) {
    return NextResponse.json({ message: "File not found" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4";

  return serveFile(request, resolved, contentType);
}
