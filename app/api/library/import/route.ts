import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { importFromLibrary } from "@/app/lib/library";

export async function POST(request: NextRequest) {
  try {
    const { folder } = await request.json();
    if (typeof folder !== "string") {
      return apiError("api.missingFolder", 400);
    }
    return NextResponse.json({ id: await importFromLibrary(folder) });
  } catch (err) {
    return apiFailure(err, "error.importFailed", 500);
  }
}
