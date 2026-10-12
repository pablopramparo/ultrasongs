import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import JSZip from "jszip";
import { alignLyrics } from "@/app/lib/align";
import { msToBeats, buildUltrastarTxt, detectBpm, editorNotesToUltrastar } from "@/app/lib/ultrastar";
import type { WordTimestamp, Pause } from "@/app/api/transcribe/route";
import type { UltrastarNote } from "@/app/lib/ultrastar";
import type { EditorNote } from "@/app/lib/editorNote";
import { resolveAllowed } from "@/app/lib/safePath";
import { saveSongFolder } from "@/app/lib/songFolder";
import { errorMessage } from "@/app/lib/appError";
import { getRequestLang } from "@/app/i18n/server";
import { getSongsDir } from "@/app/lib/settings";

// Mode A: auto-align from raw transcription
interface GenerateAuto {
  mp3: string;
  words: WordTimestamp[];
  language: string;
  lyrics: string;
  title: string;
  artist: string;
  draftId?: string;
  pauses?: Pause[];
  videoPath?: string;
  vocalsPath?: string;
  accompanimentPath?: string;
}

// Mode B: use notes already edited in the timeline editor
interface GenerateFromEditor {
  mp3: string;
  editedNotes: EditorNote[];
  bpm: number;
  gap: number;
  title: string;
  artist: string;
  draftId?: string;
  videoPath?: string;
  vocalsPath?: string;
  accompanimentPath?: string;
}

type GenerateRequest = GenerateAuto | GenerateFromEditor;

function isFromEditor(b: GenerateRequest): b is GenerateFromEditor {
  return "editedNotes" in b;
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const { title, artist } = body;

    if (!body.mp3 || !title || !artist) {
      return apiError("api.missingFields", 400);
    }
    const mp3 = resolveAllowed(body.mp3);
    if (!mp3) {
      return apiError("api.invalidPath", 403);
    }
    if (!existsSync(mp3)) {
      return apiError("api.audioNotFound", 404);
    }

    let bpm: number;
    let gap: number;
    const ultraNotes: UltrastarNote[] = [];

    if (isFromEditor(body)) {
      // ── Mode B: editor notes ───────────────────────────────────────────────
      ({ bpm, gap } = body);
      ultraNotes.push(...editorNotesToUltrastar(body.editedNotes, bpm, gap));
    } else {
      // ── Mode A: auto-align ─────────────────────────────────────────────────
      const { words, language, lyrics, pauses } = body;
      if (!words?.length || !lyrics) {
        return apiError("api.missingWordsLyrics", 400);
      }

      ({ bpm } = await detectBpm(mp3));

      const aligned = alignLyrics(lyrics, words, language, pauses);
      const firstSyl = aligned.find((s) => !s.isLineBreak && s.start > 0);
      gap = firstSyl ? Math.max(0, firstSyl.start * 1000 - 500) : 0;
      let prevEnd = -1;

      for (const syl of aligned) {
        if (syl.isLineBreak) {
          const nextNoteBeat = msToBeats(syl.start * 1000, bpm, gap);

          // Cap the last note of this paragraph so it doesn't drag into the gap.
          // Whisper often extends the final word's duration well into the silence.
          const last = ultraNotes[ultraNotes.length - 1];
          if (last && last.type !== "-") {
            const maxDur = Math.max(1, nextNoteBeat - 2 - last.startBeat);
            if (last.duration > maxDur) {
              last.duration = maxDur;
              prevEnd = last.startBeat + maxDur;
            }
          }

          // Line break 4 beats before next note — gives Ultrastar display transition time.
          // Must be after the (possibly capped) last note.
          const lineBreakBeat = Math.max(prevEnd >= 0 ? prevEnd + 1 : 0, nextNoteBeat - 4);
          ultraNotes.push({ type: "-", startBeat: lineBreakBeat, duration: 0, pitch: 0, syllable: "" });
          // Keep prevEnd at lineBreakBeat so the first note of the next phrase
          // never starts before the line break marker.
          prevEnd = lineBreakBeat;
          continue;
        }
        const startBeat = msToBeats(syl.start * 1000, bpm, gap);
        const duration = Math.max(1, msToBeats(syl.end * 1000, bpm, gap) - startBeat);
        const adjStart = prevEnd >= 0 ? Math.max(startBeat, prevEnd + 1) : startBeat;
        ultraNotes.push({ type: ":", startBeat: adjStart, duration, pitch: syl.midi, syllable: syl.syllable });
        prevEnd = adjStart + duration;
      }
    }

    const videoPath = resolveAllowed(body.videoPath) ?? undefined;
    const vocalsPath = resolveAllowed(body.vocalsPath) ?? undefined;
    const accompanimentPath = resolveAllowed(body.accompanimentPath) ?? undefined;
    const mp3Filename = path.basename(mp3);
    const videoFilename = videoPath ? path.basename(videoPath) : undefined;
    const txt = buildUltrastarTxt(ultraNotes, { title, artist, mp3: mp3Filename, bpm, gap, video: videoFilename });

    const zip = new JSZip();
    zip.file(`${title}.txt`, txt);
    zip.file(mp3Filename, await readFile(mp3));
    if (videoPath && existsSync(videoPath)) {
      zip.file(videoFilename!, await readFile(videoPath));
    }
    if (vocalsPath && existsSync(vocalsPath)) {
      zip.file("vocals.mp3", await readFile(vocalsPath));
    }
    if (accompanimentPath && existsSync(accompanimentPath)) {
      zip.file("accompaniment.mp3", await readFile(accompanimentPath));
    }
    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    const headers: Record<string, string> = {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${title}.zip"`,
    };

    // Optional: also drop the song folder straight into the configured Songs directory.
    // A failure here must not lose the ZIP, so it is reported via a header instead.
    const songsDir = getSongsDir();
    if (songsDir) {
      try {
        const dir = await saveSongFolder({
          songsDir, title, artist, notes: ultraNotes, bpm, gap,
          mp3Path: mp3,
          draftId: typeof body.draftId === "string" ? body.draftId : undefined,
          videoPath: videoPath && existsSync(videoPath) ? videoPath : undefined,
        });
        headers["X-Saved-To"] = encodeURIComponent(dir);
      } catch (saveErr) {
        console.error("[generate] save to songs folder", saveErr);
        headers["X-Save-Error"] = encodeURIComponent(errorMessage(saveErr, await getRequestLang(), "settings.saveFailed"));
      }
    }

    return new NextResponse(new Uint8Array(zipBuf), { status: 200, headers });
  } catch (err) {
    console.error("[generate]", err);
    return apiFailure(err, "error.generateFailed", 500);
  }
}
