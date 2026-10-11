import os from "os";
import path from "path";
import { existsSync, readFileSync } from "fs";

/**
 * Where the installer puts the Python runtime, venv and models (per user, outside the app bundle).
 * Same folder the desktop shell uses (Tauri's app-local-data dir, named after the bundle identifier),
 * and deliberately not %LOCALAPPDATA%\Ultrasongs, which is the install folder: uninstalling must
 * not take models and drafts with it.
 */
export const APP_HOME = path.resolve(
  process.env.ULTRASONGS_HOME ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "com.ultrasongs.app")
);

/** Folder with transcribe_service.py, whisperx_worker.py, download_models.py, requirements.lock.txt. */
export const PYTHON_SRC_DIR = path.resolve(process.env.ULTRASONGS_PYTHON_SRC ?? path.join(process.cwd(), "python"));

export const RUNTIME_DIR = path.join(APP_HOME, "runtime"); // python-build-standalone extracts to runtime/python
export const BASE_PYTHON = path.join(RUNTIME_DIR, "python", "python.exe");
export const VENV_DIR = path.join(APP_HOME, "venv");
export const VENV_PYTHON = path.join(VENV_DIR, "Scripts", "python.exe");
export const HF_HOME = path.join(APP_HOME, "models", "hf");
export const TORCH_HOME = path.join(APP_HOME, "models", "torch");
export const LOG_DIR = path.join(APP_HOME, "logs");
export const STATE_FILE = path.join(APP_HOME, "setup-state.json");

/** Bump to make already-installed copies re-run setup (e.g. after changing requirements.lock.txt). */
export const SETUP_VERSION = 1;

export interface SetupState {
  version: number;
  device: "cuda" | "cpu";
  whisperModel: string;
  completedAt: string;
}

export function readSetupState(): SetupState | null {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8")) as SetupState;
    return s.version === SETUP_VERSION ? s : null;
  } catch {
    return null;
  }
}

/**
 * The interpreter that has the pipeline's packages: explicit override, then the installer's venv
 * (only once setup finished), then the project's own python/.venv for development. Null if none.
 */
export function resolvePython(): string | null {
  const override = process.env.ULTRASONGS_PYTHON;
  if (override && existsSync(override)) return override;
  if (readSetupState() && existsSync(VENV_PYTHON)) return VENV_PYTHON;
  const dev = path.join(PYTHON_SRC_DIR, ".venv", "Scripts", "python.exe");
  return existsSync(dev) ? dev : null;
}
