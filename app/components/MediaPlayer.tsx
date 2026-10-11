"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";
import RangeSlider from "./RangeSlider";

interface Props {
  audioUrl: string;
  /** Optional picture track, kept in sync with the audio and always muted. */
  videoUrl?: string | null;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Audio player with its own controls (the browser's native bar can't be themed). The audio element
 * is the clock; the video, when present, follows it.
 */
export default function MediaPlayer({ audioUrl, videoUrl }: Props) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const syncVideo = (force = false) => {
    const a = audioRef.current;
    const v = videoRef.current;
    if (!a || !v) return;
    if (force || Math.abs(v.currentTime - a.currentTime) > 0.25) v.currentTime = a.currentTime;
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const seek = (v: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = v;
    setCurrent(v);
    syncVideo(true);
  };

  const setVol = (v: number) => {
    setVolume(v);
    setMuted(v === 0);
    if (audioRef.current) {
      audioRef.current.volume = v;
      audioRef.current.muted = v === 0;
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  };

  const iconBtn =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white";

  return (
    <div className="flex flex-col gap-3">
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          onClick={toggle}
          className="aspect-video w-full cursor-pointer rounded-lg bg-black object-contain"
        />
      )}

      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => { setCurrent(e.currentTarget.currentTime); syncVideo(); }}
        onPlay={() => { setPlaying(true); syncVideo(true); videoRef.current?.play().catch(() => {}); }}
        onPause={() => { setPlaying(false); videoRef.current?.pause(); }}
        onEnded={() => { setPlaying(false); videoRef.current?.pause(); }}
        onSeeked={() => syncVideo(true)}
      />

      <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? t("player.pause") : t("player.play")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-500"
        >
          {playing ? (
            <svg viewBox="0 0 10 10" className="h-3.5 w-3.5" fill="currentColor">
              <rect x="1" y="1" width="3" height="8" rx="0.5" /><rect x="6" y="1" width="3" height="8" rx="0.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" className="h-3.5 w-3.5" fill="currentColor">
              <polygon points="2.2,1 9,5 2.2,9" />
            </svg>
          )}
        </button>

        <span className="w-[5.5rem] shrink-0 font-mono text-xs tabular-nums text-zinc-400">
          {fmt(current)} / {fmt(duration)}
        </span>

        <RangeSlider value={current} max={duration} step={0.1} onChange={seek} label={t("player.seek")} className="min-w-0 flex-1" />

        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? t("player.unmute") : t("player.mute")}
          className={iconBtn}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5L6 9H3v6h3l5 4V5z" />
            {muted || volume === 0 ? (
              <path d="M22 9l-6 6M16 9l6 6" />
            ) : (
              <path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" />
            )}
          </svg>
        </button>
        <RangeSlider value={muted ? 0 : volume} max={1} step={0.05} onChange={setVol} label={t("player.volume")} className="w-20 shrink-0" />
      </div>
    </div>
  );
}
