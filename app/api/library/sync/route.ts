import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { syncDraftFromFolder } from "@/app/lib/library";

/** Loads the notes of a Songs folder's .txt into the draft linked to that folder. */
export async function POST(request: NextRequest) {
  try {
    const { folder } = await request.json();
    if (typeof folder !== "string") {
      return apiError("api.missingFolder", 400);
    }
    return NextResponse.json({ id: await syncDraftFromFolder(folder) });
  } catch (err) {
    return apiFailure(err, "api.genericFailed", 500);
  }
}
