import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { existsSync } from "fs";
import { alignLyrics } from "@/app/lib/align";
import { detectBpm } from "@/app/lib/ultrastar";
import type { WordTimestamp, Pause } from "@/app/api/transcribe/route";
import type { EditorNote } from "@/app/lib/editorNote";
import { resolveAllowed } from "@/app/lib/safePath";

interface AlignRequest {
  mp3: string;
  words: WordTimestamp[];
  language: string;
  lyrics: string;
  pauses?: Pause[];
}

export async function POST(request: NextRequest) {
  try {
    const { mp3: mp3Param, words, language, lyrics, pauses }: AlignRequest = await request.json();

    if (!mp3Param || !words?.length || !lyrics) {
      return apiError("api.missingFields", 400);
    }
    const mp3 = resolveAllowed(mp3Param);
    if (!mp3) {
      return apiError("api.invalidPath", 403);
    }
    if (!existsSync(mp3)) {
      return apiError("api.audioNotFound", 404);
    }

    const [aligned, { bpm }] = await Promise.all([
      Promise.resolve(alignLyrics(lyrics, words, language, pauses)),
      detectBpm(mp3),
    ]);

    const duration = words.at(-1)?.end ?? 0;

    const notes: EditorNote[] = aligned
      .filter((s) => !s.isLineBreak)
      .map((s, i) => ({
        id: `n${i}`,
        syllable: s.syllable,
        startSec: s.start,
        durationSec: Math.max(0.1, s.end - s.start),
        pitch: s.midi,
        type: ":" as const,
      }));

    // GAP = first note start minus a small lead-in (ms)
    const firstStart = notes[0]?.startSec ?? 0;
    const gap = Math.max(0, firstStart * 1000 - 500);

    return NextResponse.json({ notes, bpm, gap, duration });
  } catch (err) {
    console.error("[align]", err);
    return apiFailure(err, "error.alignFailed", 500);
  }
}
