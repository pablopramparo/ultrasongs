import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { ensureService } from "@/app/lib/setup/service";
import { existsSync } from "fs";
import { resolveAllowed } from "@/app/lib/safePath";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8001";

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  midi: number;
  pitchFrames?: Array<{
    time: number;
    midi: number;
    confidence: number;
  }>;
}

export interface Pause {
  start: number;
  end: number;
}

export interface TranscribeResult {
  words: WordTimestamp[];
  language: string;
  vocalsPath?: string;
  accompanimentPath?: string;
  pauses?: Pause[];
}

export async function POST(request: NextRequest) {
  try {
    const { mp3: mp3Param, lyrics } = await request.json();

    if (!mp3Param || typeof mp3Param !== "string") {
      return apiError("api.missingParam", 400, { name: "mp3" });
    }
    const mp3 = resolveAllowed(mp3Param);
    if (!mp3) {
      return apiError("api.invalidPath", 403);
    }
    if (!existsSync(mp3)) {
      return apiError("api.audioNotFound", 404);
    }

    // Packaged installs have no one else to start the Python service.
    await ensureService().catch(() => null);

    const formData = new FormData();
    formData.append("mp3_path", mp3);
    if (lyrics && typeof lyrics === "string") formData.append("lyrics", lyrics);

    let serviceRes: Response;
    try {
      serviceRes = await fetch(`${PYTHON_SERVICE_URL}/transcribe`, {
        method: "POST",
        body: formData,
        // No AbortController here — the Python service streams SSE and manages
        // its own processing time. The client applies its own timeout.
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : "";
      const isDown = /ECONNREFUSED|ENOTFOUND|ECONNRESET|socket hang up|fetch failed/i.test(msg);
      if (isDown) {
        return apiError("api.serviceDown", 503);
      }
      throw fetchErr;
    }

    if (!serviceRes.ok) {
      const detail = await serviceRes.text();
      return apiError("api.serviceError", 502, { detail });
    }

    // Proxy the SSE stream from Python directly to the browser.
    return new NextResponse(serviceRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[transcribe]", err);
    return apiFailure(err, "api.transcribeFailed", 500);
  }
}
