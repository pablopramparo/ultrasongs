import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { parseUltrastarTxt } from "@/app/lib/ultrastar";
import type { EditorNote } from "@/app/lib/editorNote";
import { DRAFTS_DIR } from "@/app/lib/safePath";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const txtFile = form.get("txt") as File | null;
    const mp3File = form.get("mp3") as File | null;
    const videoFile = form.get("video") as File | null;

    if (!txtFile || !mp3File) {
      return NextResponse.json({ message: "Se requiere el archivo .txt y el .mp3" }, { status: 400 });
    }

    const txtContent = await txtFile.text();
    const parsed = parseUltrastarTxt(txtContent);

    const { bpm, gap, notes } = parsed;
    const beatsPerSec = (bpm / 60) * 4;

    const editorNotes: EditorNote[] = notes
      .filter((n) => n.type !== "-")
      .map((n) => ({
        id: crypto.randomUUID(),
        syllable: n.syllable,
        startSec: gap / 1000 + n.startBeat / beatsPerSec,
        durationSec: Math.max(0.01, n.duration / beatsPerSec),
        pitch: n.pitch,
        type: n.type as ":" | "*",
      }));

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
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
