/**
 * Build-time feature switches. NEXT_PUBLIC_* values are inlined by Next, so a build made with
 * NEXT_PUBLIC_ENABLE_YOUTUBE=0 ships without the YouTube downloader (UI hidden, route disabled).
 * Used for the Microsoft Store build, where yt-dlp can't be kept up to date inside the package.
 */
export const YOUTUBE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_YOUTUBE !== "0";
