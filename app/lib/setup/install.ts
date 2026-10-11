import { spawn } from "child_process";
import { createWriteStream, existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import {
  APP_HOME, BASE_PYTHON, HF_HOME, LOG_DIR, PYTHON_SRC_DIR, RUNTIME_DIR, SETUP_VERSION, STATE_FILE,
  TORCH_HOME, VENV_DIR, VENV_PYTHON, readSetupState, type SetupState,
} from "./paths";
import type { MessageKey } from "@/app/i18n";
import { AppError } from "@/app/lib/appError";

export interface SetupEvent {
  step: "gpu" | "python" | "venv" | "torch" | "packages" | "models" | "done";
  /** Spanish fallback text; the UI prefers `key` + `vars` so it can show its own language. */
  message: string;
  key?: MessageKey;
  vars?: Record<string, string | number>;
  /** Overall progress 0..1. */
  progress: number;
  done?: boolean;
  error?: string;
}
type Emit = (e: SetupEvent) => void;

const PY_RELEASES_API = "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest";
const TORCH_VERSION = "2.8.0";
const TORCH_INDEX = { cuda: "https://download.pytorch.org/whl/cu126", cpu: "https://download.pytorch.org/whl/cpu" };
/** Whisper model per device: `medium` is what the GTX 1080 setup was tuned with; CPUs get `small`. */
const WHISPER_MODEL = { cuda: process.env.WHISPERX_MODEL ?? "medium", cpu: "small" };

/** Share of the overall progress bar each step takes, and where it starts. */
const WEIGHTS = { gpu: 0.01, python: 0.07, venv: 0.02, torch: 0.5, packages: 0.15, models: 0.25 } as const;
const START = { gpu: 0, python: 0.01, venv: 0.08, torch: 0.1, packages: 0.6, models: 0.75 } as const;

export function hasNvidiaGpu(): Promise<{ cuda: boolean; name?: string }> {
  // ULTRASONGS_FORCE_DEVICE=cpu skips the CUDA build (testing, or a broken NVIDIA driver).
  if (process.env.ULTRASONGS_FORCE_DEVICE === "cpu") return Promise.resolve({ cuda: false });
  return new Promise((resolve) => {
    const p = spawn("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve({ cuda: false }));
    p.on("close", (code) => {
      const name = out.trim().split(/\r?\n/)[0];
      resolve(code === 0 && name ? { cuda: true, name } : { cuda: false });
    });
  });
}

async function download(url: string, dest: string, onBytes: (got: number, total: number) => void): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "ultrasongs-installer" } });
  if (!res.ok || !res.body) throw new AppError("setup.err.download", { status: res.status, url });
  const total = Number(res.headers.get("content-length") ?? 0);
  let got = 0;
  const body = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
  body.on("data", (c: Buffer) => { got += c.length; onBytes(got, total); });
  await pipeline(body, createWriteStream(dest));
}

/** Runs a command, forwarding each output line; rejects on a non-zero exit. */
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; onLine?: (l: string) => void }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, windowsHide: true });
    let tail = "";
    const feed = (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail = (tail + "\n" + line).split("\n").slice(-12).join("\n");
        try {
          opts.onLine?.(line);
        } catch (err) {
          p.kill();
          reject(err);
        }
      }
    };
    p.stdout.on("data", feed);
    p.stderr.on("data", feed);
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new AppError("setup.err.processExit", { name: path.basename(cmd), code: code ?? -1, tail }))
    );
  });
}

async function findPythonAsset(): Promise<{ url: string; size: number }> {
  const res = await fetch(PY_RELEASES_API, {
    headers: { "User-Agent": "ultrasongs-installer", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new AppError("setup.err.pythonVersions", { status: res.status });
  const rel = (await res.json()) as { assets: { name: string; browser_download_url: string; size: number }[] };
  const asset = rel.assets.find((a) =>
    /^cpython-3\.12\.\d+\+.*-x86_64-pc-windows-msvc-install_only\.tar\.gz$/.test(a.name)
  );
  if (!asset) throw new AppError("setup.err.noPythonAsset");
  return { url: asset.browser_download_url, size: asset.size };
}

/** Environment the transcription service needs (model caches, ffmpeg, engine, model size). */
export function serviceEnv(): Record<string, string> {
  const state = readSetupState();
  return {
    HF_HOME,
    TORCH_HOME,
    HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
    PYTHONUTF8: "1",
    FFMPEG_PATH: ffmpegInstaller.path,
    ALIGN_ENGINE: process.env.ALIGN_ENGINE ?? "whisperx",
    WHISPERX_MODEL: process.env.WHISPERX_MODEL ?? state?.whisperModel ?? "medium",
  };
}

let running: Promise<void> | null = null;

/** Installs everything the pipeline needs. Safe to call twice: a second call joins the first. */
export function runSetup(emit: Emit): Promise<void> {
  if (!running) {
    running = doSetup(emit).finally(() => { running = null; });
  }
  return running;
}

async function doSetup(emit: Emit): Promise<void> {
  const ev = (
    step: Exclude<SetupEvent["step"], "done">,
    message: string,
    frac = 0,
    key?: MessageKey,
    vars?: Record<string, string | number>
  ): void =>
    emit({ step, message, key, vars, progress: START[step] + WEIGHTS[step] * Math.min(1, Math.max(0, frac)) });

  await mkdir(APP_HOME, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });

  ev("gpu", "Detectando placa de video…", 0, "setup.ev.detectingGpu");
  const gpu = await hasNvidiaGpu();
  const device = gpu.cuda ? "cuda" : "cpu";
  ev(
    "gpu",
    gpu.cuda ? `GPU NVIDIA detectada: ${gpu.name}` : "Sin GPU NVIDIA: se usará la CPU (más lento)",
    1,
    gpu.cuda ? "setup.ev.gpuFound" : "setup.noGpu",
    gpu.cuda ? { name: gpu.name ?? "" } : undefined
  );

  // 1 — Python runtime
  if (!existsSync(BASE_PYTHON)) {
    ev("python", "Buscando Python…", 0, "setup.ev.findPython");
    const asset = await findPythonAsset();
    const archive = path.join(APP_HOME, "python.tar.gz");
    await download(asset.url, archive, (got, total) => {
      const t = total || asset.size;
      ev(
        "python",
        `Descargando Python (${Math.round(got / 1e6)} / ${Math.round(t / 1e6)} MB)`,
        (got / t) * 0.9,
        "setup.ev.downloadPython",
        { got: Math.round(got / 1e6), total: Math.round(t / 1e6) }
      );
    });
    ev("python", "Descomprimiendo Python…", 0.95, "setup.ev.unpackPython");
    await rm(RUNTIME_DIR, { recursive: true, force: true });
    await mkdir(RUNTIME_DIR, { recursive: true });
    // Windows' own bsdtar; Git's GNU tar can't handle drive-letter paths.
    const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    await run(existsSync(tar) ? tar : "tar", ["-xzf", archive, "-C", RUNTIME_DIR], {});
    await rm(archive, { force: true });
    if (!existsSync(BASE_PYTHON)) throw new AppError("setup.err.badArchive");
  }
  await rm(path.join(APP_HOME, "python.tar.gz"), { force: true }); // left over from an interrupted run
  ev("python", "Python listo", 1, "setup.ev.pythonReady");

  // 2 — virtual environment
  if (!existsSync(VENV_PYTHON)) {
    ev("venv", "Creando entorno virtual…", 0, "setup.ev.createVenv");
    await run(BASE_PYTHON, ["-m", "venv", VENV_DIR], {});
  }
  ev("venv", "Entorno virtual listo", 1, "setup.ev.venvReady");

  const pip = (args: string[], onLine: (l: string) => void) =>
    run(
      VENV_PYTHON,
      ["-m", "pip", "install", "--no-input", "--progress-bar", "off", "--disable-pip-version-check", ...args],
      { onLine }
    );

  // 3 — torch (CUDA or CPU build)
  ev(
    "torch",
    `Instalando PyTorch ${device === "cuda" ? "(CUDA, ~3 GB)" : "(CPU)"}…`,
    0,
    device === "cuda" ? "setup.ev.installTorchCuda" : "setup.ev.installTorchCpu"
  );
  let seen = 0;
  await pip(
    [`torch==${TORCH_VERSION}`, `torchaudio==${TORCH_VERSION}`, "--index-url", TORCH_INDEX[device]],
    (line) => {
      if (/^(Collecting|Downloading|Installing)/.test(line)) ev("torch", line.slice(0, 90), Math.min(0.95, ++seen / 40));
    }
  );
  ev("torch", "PyTorch listo", 1, "setup.ev.torchReady");

  // 4 — everything else, pinned
  ev("packages", "Instalando paquetes…", 0, "setup.ev.installPackages");
  const lock = path.join(PYTHON_SRC_DIR, "requirements.lock.txt");
  if (!existsSync(lock)) throw new AppError("setup.err.missingLock", { path: lock });
  seen = 0;
  await pip(["-r", lock], (line) => {
    if (/^(Collecting|Downloading|Installing)/.test(line)) ev("packages", line.slice(0, 90), Math.min(0.95, ++seen / 260));
  });
  ev("packages", "Paquetes listos", 1, "setup.ev.packagesReady");

  // 5 — models
  const whisperModel = WHISPER_MODEL[device];
  ev("models", "Descargando modelos…", 0, "setup.ev.downloadModels");
  const modelScript = path.join(PYTHON_SRC_DIR, "download_models.py");
  let stage = 0;
  await run(VENV_PYTHON, [modelScript, "--whisper-model", whisperModel], {
    cwd: PYTHON_SRC_DIR,
    env: { HF_HOME, TORCH_HOME, PYTHONUTF8: "1", HF_HUB_DISABLE_SYMLINKS_WARNING: "1" },
    onLine: (line) => {
      let j: { stage?: string; error?: string; key?: MessageKey; vars?: Record<string, string | number> };
      try {
        j = JSON.parse(line);
      } catch {
        return; // library log noise
      }
      if (j.error) throw new Error(j.error);
      if (j.stage) ev("models", j.stage, Math.min(0.95, ++stage / 4), j.key, j.vars);
    },
  });

  const state: SetupState = { version: SETUP_VERSION, device, whisperModel, completedAt: new Date().toISOString() };
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  emit({ step: "done", message: "Instalación completa", key: "setup.ev.done", progress: 1, done: true });
}
