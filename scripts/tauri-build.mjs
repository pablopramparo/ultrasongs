/**
 * `tauri build` with the updater signing key, then writes latest.json for the auto-updater.
 *
 * The key is read from TAURI_SIGNING_PRIVATE_KEY, or from ~/.tauri/ultrasongs-updater.key (created with
 * `pnpm tauri signer generate -w ~/.tauri/ultrasongs-updater.key`). Losing it means installed apps can
 * never update again, so keep a backup. The matching public key lives in src-tauri/tauri.conf.json.
 *
 * latest.json is what installed apps fetch (raw.githubusercontent.com, master): commit and push it
 * together with the release, after uploading the installer and its asset to the GitHub release.
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "pablopramparo/ultrasongs";

const keyPath = resolve(homedir(), ".tauri", "ultrasongs-updater.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  if (!existsSync(keyPath)) {
    console.error(`[build] no updater signing key: set TAURI_SIGNING_PRIVATE_KEY or create ${keyPath}`);
    process.exit(1);
  }
  process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf8");
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
}

const build = spawnSync("pnpm", ["tauri", "build"], { cwd: ROOT, stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const { version } = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const installer = `Ultrasongs_${version}_x64-setup.exe`;
const sigFile = resolve(ROOT, "src-tauri", "target", "release", "bundle", "nsis", `${installer}.sig`);
if (!existsSync(sigFile)) {
  console.error(`[build] ${sigFile} not found: is createUpdaterArtifacts on?`);
  process.exit(1);
}

const manifest = {
  version,
  notes: process.env.RELEASE_NOTES ?? `Ultrasongs ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(sigFile, "utf8").trim(),
      url: `https://github.com/${REPO}/releases/download/v${version}/${installer}`,
    },
  },
};
writeFileSync(resolve(ROOT, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`[build] wrote latest.json for v${version}`);
