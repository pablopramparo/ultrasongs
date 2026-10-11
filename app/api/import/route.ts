import { NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure } from "@/app/lib/apiResponse";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { parseUltrastarTxt } from "@/app/lib/ultrastar";
import { ultrastarToEditorNotes } from "@/app/lib/library";
import { DRAFTS_DIR } from "@/app/lib/safePath";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const txtFile = form.get("txt") as File | null;
    const mp3File = form.get("mp3") as File | null;
    const videoFile = form.get("video") as File | null;

    if (!txtFile || !mp3File) {
      return apiError("api.importNeedsFiles", 400);
    }

    const txtContent = await txtFile.text();
    const parsed = parseUltrastarTxt(txtContent);

    const { bpm, gap } = parsed;
    const editorNotes = ultrastarToEditorNotes(parsed);

    const id = crypto.randomUUID();
    const dir = path.join(DRAFTS_DIR, id);
    await mkdir(dir, { recursive: true });

    const mp3Bytes = new Uint8Array(await mp3File.arrayBuffer());
    await writeFile(path.join(dir, "audio.mp3"), mp3Bytes);

    let videoFilename: string | undefined;
    if (videoFile) {
      const ext = path.extname(videoFile.name).toLowerCase() || ".mp4";
      videoFilename = "video" + ext;
      await writeFile(path.join(dir, videoFilename), new Uint8Array(await videoFile.arrayBuffer()));
    }

    const draft = {
      id,
      title: parsed.title,
      artist: parsed.artist,
      lyrics: "",
      savedAt: new Date().toISOString(),
      bpm,
      gap,
      notes: editorNotes,
      words: [],
      language: "",
      pauses: [],
      audioFilename: "audio.mp3",
      videoFilename,
    };

    await writeFile(path.join(dir, "draft.json"), JSON.stringify(draft));
    return NextResponse.json({ id });
  } catch (err) {
    return apiFailure(err, "error.importFailed", 500);
  }
}
