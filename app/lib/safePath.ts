import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";

export const TMP_DIR = path.resolve(process.env.TMP_DIR ?? "./tmp");
export const DRAFTS_DIR = path.resolve(process.env.DRAFTS_DIR ?? "./drafts");

/** True when `target` is `base` itself or lives somewhere under it. */
export function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Resolves a client-supplied path; returns null unless it is inside TMP_DIR or DRAFTS_DIR. */
export function resolveAllowed(p: unknown): string | null {
  if (typeof p !== "string" || !p || p.includes("\0")) return null;
  const resolved = path.resolve(p);
  return isInside(TMP_DIR, resolved) || isInside(DRAFTS_DIR, resolved) ? resolved : null;
}

const DRAFT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Returns the draft directory for a well-formed id, or null. */
export function draftDir(id: unknown): string | null {
  if (typeof id !== "string" || !DRAFT_ID_RE.test(id)) return null;
  return path.join(DRAFTS_DIR, id);
}

/** Streams a file honouring HTTP Range requests (needed for seeking in <audio>/<video>). */
export async function serveFile(request: Request, filePath: string, contentType: string): Promise<Response> {
  const { size } = await stat(filePath);
  const baseHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  const range = request.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start: number;
    let end: number;
    if (m[1] === "") {
      // suffix range: last N bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...baseHeaders, "Content-Length": String(size) } });
}
