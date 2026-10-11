import type { NextConfig } from "next";

// Packaging builds (Tauri sidecar) set NEXT_OUTPUT=standalone to get a self-contained server.
// It is opt-in because `next start` (start.bat) does not work with standalone output.
const standalone = process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = {
  serverExternalPackages: ["fluent-ffmpeg", "@ffmpeg-installer/ffmpeg", "hyphen", "music-tempo"],
  ...(standalone
    ? {
        output: "standalone" as const,
        distDir: ".next-standalone",
        // Runtime data lives outside the bundle (TMP_DIR / DRAFTS_DIR / SONGS_DIR); without this
        // the tracer copies ./drafts and ./tmp into the server bundle (~850 MB).
        outputFileTracingExcludes: {
          "*": ["./drafts/**", "./tmp/**", "./python/**", "./.next/**", "./src-tauri/**", "./tauri-shell/**", "./scripts/**"],
        },
      }
    : {}),
};

export default nextConfig;
