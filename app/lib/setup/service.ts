import { spawn } from "child_process";
import { createConnection } from "net";
import { mkdirSync, openSync } from "fs";
import path from "path";
import { LOG_DIR, PYTHON_SRC_DIR, resolvePython } from "./paths";
import { serviceEnv } from "./install";

const HOST = "127.0.0.1";
const PORT = 8001;

export function portOpen(port = PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port, host: HOST });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 600);
  });
}

let starting: Promise<void> | null = null;

/**
 * Makes sure the transcription service is listening. Dev setups start it themselves (start.bat,
 * dev:all) and this returns at once; a packaged install has no one else to start it.
 * Resolves quietly if there's no interpreter — callers keep their own "service down" message.
 */
export function ensureService(): Promise<void> {
  if (!starting) starting = start().finally(() => { starting = null; });
  return starting;
}

async function start(): Promise<void> {
  if (await portOpen()) return;
  const python = resolvePython();
  if (!python) return;

  mkdirSync(LOG_DIR, { recursive: true });
  const log = openSync(path.join(LOG_DIR, "service.log"), "a");
  const proc = spawn(python, ["-m", "uvicorn", "transcribe_service:app", "--host", HOST, "--port", String(PORT)], {
    cwd: PYTHON_SRC_DIR,
    env: { ...process.env, ...serviceEnv() },
    // Not `detached`: on Windows that means "no console at all", and every child the service starts
    // (WhisperX worker, ffmpeg) would then pop up its own console window. With windowsHide the
    // service gets one hidden console that its children inherit. It also stays in the shell's job
    // object, so it is stopped together with the app.
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  proc.unref();

  // Whisper/Demucs imports take a while on a cold start.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await portOpen()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
