import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { resolveAllowed, serveFile } from "@/app/lib/safePath";

export async function GET(request: NextRequest) {
  const mp3 = request.nextUrl.searchParams.get("mp3");

  if (!mp3) {
    return NextResponse.json({ message: "Missing mp3 param" }, { status: 400 });
  }

  const resolved = resolveAllowed(mp3);
  if (!resolved) {
    return NextResponse.json({ message: "Invalid path" }, { status: 403 });
  }

  if (!existsSync(resolved)) {
    return NextResponse.json({ message: "File not found" }, { status: 404 });
  }

  return serveFile(request, resolved, "audio/mpeg");
}
