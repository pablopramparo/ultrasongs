import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { getSongsDir, setSongsDir, songsDirIsLocked } from "@/app/lib/settings";

export async function GET() {
  return NextResponse.json({ songsDir: getSongsDir(), songsDirLocked: songsDirIsLocked() });
}

export async function POST(request: NextRequest) {
  try {
    if (songsDirIsLocked()) {
      return apiError("api.songsDirLocked", 409);
    }
    const { songsDir } = await request.json();
    if (typeof songsDir !== "string" || !songsDir.trim()) {
      return apiError("api.missingFolder", 400);
    }
    return NextResponse.json({ songsDir: await setSongsDir(songsDir.trim()) });
  } catch (err) {
    return apiFailure(err, "settings.saveFailed", 400);
  }
}
