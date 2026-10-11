/**
 * Prepares everything `tauri build` bundles:
 *  1. Next.js standalone server (NEXT_PUBLIC_ENABLE_YOUTUBE is passed through, set it to 0 to drop YouTube)
 *  2. its static assets and public/ folder, which standalone output leaves out
 *  3. a copy of this machine's node.exe as the sidecar binary Tauri expects
 */
import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, ".next-standalone");
const STANDALONE = resolve(DIST, "standalone");
const BIN_DIR = resolve(ROOT, "src-tauri", "binaries");

console.log("[prepare] building Next.js (standalone)…");
rmSync(DIST, { recursive: true, force: true });
const build = spawnSync("pnpm", ["build"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_OUTPUT: "standalone" },
});
if (build.status !== 0) process.exit(build.status ?? 1);
if (!existsSync(resolve(STANDALONE, "server.js"))) {
  console.error("[prepare] standalone/server.js not found");
  process.exit(1);
}

console.log("[prepare] copying static assets…");
mkdirSync(resolve(STANDALONE, ".next-standalone"), { recursive: true });
cpSync(resolve(DIST, "static"), resolve(STANDALONE, ".next-standalone", "static"), { recursive: true });
cpSync(resolve(ROOT, "public"), resolve(STANDALONE, "public"), { recursive: true });

/**
 * Standalone output uses pnpm's symlinked node_modules, and neither Tauri's resource copy nor the
 * NSIS installer preserves symlinks (externals such as @ffmpeg-installer then fail to resolve).
 * Build a bundle with a plain, hoisted node_modules instead: every package once, as real files.
 */
console.log("[prepare] flattening node_modules (no symlinks)…");
const BUNDLE = resolve(DIST, "bundle");
rmSync(BUNDLE, { recursive: true, force: true });
cpSync(STANDALONE, BUNDLE, {
  recursive: true,
  // The hashed aliases of server externals (.next-standalone/node_modules/@scope/pkg-<hash>) are symlinks too.
  dereference: true,
  filter: (src) => !src.replace(/\\/g, "/").includes("/standalone/node_modules"),
});

const srcModules = resolve(STANDALONE, "node_modules");
const outModules = resolve(BUNDLE, "node_modules");
mkdirSync(outModules, { recursive: true });

/** Package directories directly inside a node_modules folder, scoped ones included. */
function packagesIn(nm) {
  const found = [];
  if (!existsSync(nm)) return found;
  for (const name of readdirSync(nm)) {
    if (name.startsWith(".")) continue;
    const full = resolve(nm, name);
    if (name.startsWith("@")) {
      for (const sub of readdirSync(full)) found.push([`${name}/${sub}`, resolve(full, sub)]);
    } else {
      found.push([name, full]);
    }
  }
  return found;
}

function place(name, from) {
  const real = realpathSync(from);
  const dest = resolve(outModules, name);
  if (existsSync(dest)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(real, dest, { recursive: true, dereference: true });
  return true;
}

// Prefer what Next traced into standalone's own .pnpm store (already trimmed to the files the
// server needs). The top-level entries are symlinks into the *project's* full node_modules, so
// they only fill in whatever the store doesn't have.
let placed = 0;
const store = resolve(srcModules, ".pnpm");
if (existsSync(store)) {
  for (const entry of readdirSync(store)) {
    if (entry === "node_modules") continue;
    for (const [name, p] of packagesIn(resolve(store, entry, "node_modules"))) if (place(name, p)) placed++;
  }
}
for (const [name, p] of packagesIn(srcModules)) if (place(name, p)) placed++;
console.log(`[prepare] ${placed} packages hoisted`);

/**
 * Turbopack requires server externals through hashed aliases (.next-standalone/node_modules/pkg-<hash>).
 * Those must be self-sufficient: some packages look for siblings next to themselves
 * (@ffmpeg-installer/ffmpeg → @ffmpeg-installer/win32-x64). Move the siblings beside the alias and
 * drop the plain copy, which nothing requires, instead of duplicating tens of MB.
 */
const aliasModules = resolve(BUNDLE, ".next-standalone", "node_modules");
for (const [aliasName] of packagesIn(aliasModules)) {
  const m = aliasName.match(/^(.*)-[0-9a-f]{16}$/);
  if (!m) continue;
  const original = m[1];
  rmSync(resolve(outModules, original), { recursive: true, force: true });
  if (original.startsWith("@")) {
    const scope = original.split("/")[0];
    const scopeDir = resolve(outModules, scope);
    if (existsSync(scopeDir)) {
      for (const sibling of readdirSync(scopeDir)) {
        const to = resolve(aliasModules, scope, sibling);
        if (!existsSync(to)) renameSync(resolve(scopeDir, sibling), to);
      }
      rmSync(scopeDir, { recursive: true, force: true });
    }
  }
}

console.log("[prepare] copying node.exe sidecar…");
mkdirSync(BIN_DIR, { recursive: true });
cpSync(process.execPath, resolve(BIN_DIR, "node-x86_64-pc-windows-msvc.exe"));

console.log("[prepare] done. Run: pnpm tauri build");
