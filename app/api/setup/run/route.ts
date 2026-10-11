import { NextResponse } from "next/server";
import { runSetup, type SetupEvent } from "@/app/lib/setup/install";
import { errorMessage } from "@/app/lib/appError";
import { getRequestLang } from "@/app/i18n/server";
import { translate } from "@/app/i18n";

/** Runs the installer and streams progress as SSE (`data: {step,message,progress,...}`). */
export async function POST() {
  const lang = await getRequestLang();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: SetupEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client left; the install keeps going */
        }
      };
      runSetup(send)
        .catch((err) =>
          send({
            step: "done",
            progress: 0,
            message: translate(lang, "setup.failed"),
            error: errorMessage(err, lang, "setup.failed"),
          })
        )
        .finally(() => {
          try { controller.close(); } catch { /* already closed */ }
        });
    },
  });
  return new NextResponse(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
  });
}
