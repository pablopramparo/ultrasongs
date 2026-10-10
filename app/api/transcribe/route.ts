import { NextRequest, NextResponse } from "next/server";
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
      return NextResponse.json({ message: "Missing mp3 path" }, { status: 400 });
    }
    const mp3 = resolveAllowed(mp3Param);
    if (!mp3) {
      return NextResponse.json({ message: "Invalid path" }, { status: 403 });
    }
    if (!existsSync(mp3)) {
      return NextResponse.json({ message: "Audio file not found" }, { status: 404 });
    }

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
        return NextResponse.json(
          { message: "Transcription service is not running. Start it with:\n  python -m uvicorn transcribe_service:app --port 8001" },
          { status: 503 }
        );
      }
      throw fetchErr;
    }

    if (!serviceRes.ok) {
      const detail = await serviceRes.text();
      return NextResponse.json(
        { message: `Transcription service error: ${detail}` },
        { status: 502 }
      );
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
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Transcription failed" },
      { status: 500 }
    );
  }
}
