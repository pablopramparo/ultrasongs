import { NextResponse } from "next/server";
import { apiFailure } from "@/app/lib/apiResponse";
import { listLibrary } from "@/app/lib/library";
import { getSongsDir } from "@/app/lib/settings";

/** Songs found in SONGS_DIR (the Ultrastar library). */
export async function GET() {
  try {
    return NextResponse.json({ configured: !!getSongsDir(), songs: await listLibrary() });
  } catch (err) {
    return apiFailure(err, "api.genericFailed", 500);
  }
}
