/**
 * Checks if the Python transcription service is already listening on port 8001.
 * - If yes: prints a notice and keeps the process alive (so concurrently doesn't
 *   interpret an exit-0 as "done" and kill the Next.js process).
 * - If no: spawns `python -m uvicorn transcribe_service:app --port 8001 --reload`
 *   from the ./python directory and forwards its exit code.
 */
import { createConnection } from "net";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";

const PORT = 8001;
const PYTHON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../python");
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Read .env.local and forward Python-relevant vars to the subprocess
function loadEnvLocal() {
  try {
    const text = readFileSync(resolve(ROOT_DIR, ".env.local"), "utf8");
    const vars = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) vars[m[1]] = m[2].trim();
    }
    return vars;
  } catch { return {}; }
}
const envLocal = loadEnvLocal();
const PYTHON_VARS = [
  "WHISPER_MODEL",
  "TMP_DIR",
  "ALIGN_ENGINE",
  "WHISPERX_MODEL",
  "WHISPERX_LANGUAGE",
  "WHISPERX_PYTHON",
  "WHISPERX_DEVICE",
  "WHISPERX_COMPUTE_TYPE",
  "WHISPERX_BATCH_SIZE",
  "WHISPERX_USE_PROMPT",
  "DEMUCS_MODEL",
];
const extraEnv = Object.fromEntries(
  PYTHON_VARS.filter((k) => envLocal[k]).map((k) => [k, envLocal[k]])
);

// Prefer the project's single venv (python/.venv); fall back to whatever `python` is on PATH.
const VENV_PYTHON = resolve(PYTHON_DIR, ".venv", "Scripts", "python.exe");
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : "python";

function portOpen(port) {
  return new Promise((resolve) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 600);
  });
}

const already = await portOpen(PORT);

if (already) {
  console.log(`\x1b[33m[python]\x1b[0m service already running on :${PORT} — skipping start`);
  // Stay alive so concurrently doesn't kill Next.js when this "command" exits
  process.stdin.resume();
} else {
  const proc = spawn(
    PYTHON,
    ["-m", "uvicorn", "transcribe_service:app", "--port", String(PORT), "--reload"],
    { cwd: PYTHON_DIR, stdio: "inherit", env: { ...process.env, ...extraEnv } }
  );
  const code = await new Promise((res) => proc.on("exit", res));
  process.exit(code ?? 0);
}
