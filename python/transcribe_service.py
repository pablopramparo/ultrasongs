import asyncio
import gc
import json
import os
import subprocess
import sys

import lameenc
import numpy as np
import soundfile as sf
import torch
import torchcrepe
import torchaudio
from demucs.apply import apply_model
from demucs.pretrained import get_model
from fastapi import FastAPI, HTTPException, Form
from fastapi.responses import StreamingResponse
from faster_whisper import WhisperModel

app = FastAPI()

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "medium")
ALIGN_ENGINE = os.environ.get("ALIGN_ENGINE", "whisper").lower()
WHISPERX_MODEL = os.environ.get("WHISPERX_MODEL", "small")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
# large models need int8_float16 to share 8 GB VRAM with Demucs activations
COMPUTE_TYPE = "int8" if "large" in WHISPER_MODEL and DEVICE == "cuda" else "auto"

CREPE_SR = 16000
CREPE_HOP = 160   # 10 ms hop at 16 kHz

# Demucs constants — don't load the model at startup so Whisper gets full VRAM.
# DEMUCS_MODEL=htdemucs_ft gives cleaner vocals (fine-tuned per source) at ~4x the time.
DEMUCS_MODEL = os.environ.get("DEMUCS_MODEL", "htdemucs")
DEMUCS_SR = 44100

print(f"[startup] device={DEVICE}  whisper={WHISPER_MODEL}  compute={COMPUTE_TYPE}  align={ALIGN_ENGINE}")
print("[startup] Loading Whisper (Demucs loaded per-request to save VRAM)…")
whisper_model = None if ALIGN_ENGINE == "whisperx" else WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
print("[startup] WhisperX ready" if ALIGN_ENGINE == "whisperx" else "[startup] Whisper ready")


# ── helpers ──────────────────────────────────────────────────────────────────

def sse(stage: str) -> str:
    return f"data: {json.dumps({'stage': stage})}\n\n"


def hz_to_midi(hz: float) -> int:
    if hz <= 0:
        return 60
    return round(12 * np.log2(hz / 440) + 69)


def to_mp3_bytes(audio: np.ndarray, sr: int, bitrate: int = 128) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(5)
    data = enc.encode(pcm.tobytes())
    data += enc.flush()
    return data


# ── heavy processing (blocking) ───────────────────────────────────────────────

def separate_all(audio: np.ndarray, sr: int):
    """Demucs htdemucs → (vocals_mono, accompaniment_mono, out_sr).
    Loads and immediately destroys the model so VRAM is free for Whisper."""
    model = get_model(DEMUCS_MODEL)
    model.eval()
    if DEVICE == "cuda":
        model = model.cuda()
    try:
        mono = torch.from_numpy(audio.astype(np.float32))
        if sr != DEMUCS_SR:
            mono = torchaudio.functional.resample(mono.unsqueeze(0), sr, DEMUCS_SR).squeeze(0)
        wav = mono.unsqueeze(0).expand(2, -1).unsqueeze(0)  # (1, 2, samples)
        if DEVICE == "cuda":
            wav = wav.cuda()
        with torch.no_grad():
            sources = apply_model(model, wav, device=DEVICE)
        vocals_idx = model.sources.index("vocals")
        vocals = sources[0, vocals_idx].mean(0).cpu().numpy()
        acc_stems = [sources[0, i] for i in range(sources.shape[1]) if i != vocals_idx]
        accompaniment = torch.stack(acc_stems).sum(0).mean(0).cpu().numpy()
        del sources, wav, mono
    finally:
        del model
        gc.collect()
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
            print(f"[demucs] VRAM after unload: {torch.cuda.memory_allocated()//1024**2} MB")
    return vocals, accompaniment, DEMUCS_SR


def analyze_pitch(vocals: np.ndarray, sr: int):
    """
    Run torchcrepe ONCE on the entire vocals track.
    Returns (times_sec, frequencies_hz, confidences) as numpy arrays.
    """
    audio_t = torch.from_numpy(vocals.astype(np.float32))
    if sr != CREPE_SR:
        audio_t = torchaudio.functional.resample(
            audio_t.unsqueeze(0), sr, CREPE_SR
        ).squeeze(0)

    pitch, periodicity = torchcrepe.predict(
        audio_t.unsqueeze(0),       # (1, n_samples)
        sample_rate=CREPE_SR,
        hop_length=CREPE_HOP,
        fmin=65.41,    # C2
        fmax=1046.5,   # C6
        model="full",
        decoder=torchcrepe.decode.viterbi,
        return_periodicity=True,
        batch_size=2048,
        device=DEVICE,
        pad=True,
    )

    n = pitch.shape[1]
    times = np.arange(n, dtype=np.float32) * (CREPE_HOP / CREPE_SR)
    return times, pitch[0].cpu().numpy(), periodicity[0].cpu().numpy()


def get_midi_for_word(times, freqs, confs, start_sec, end_sec) -> int:
    for threshold in (0.5, 0.3, 0.1):
        mask = (times >= start_sec) & (times <= end_sec) & (confs > threshold)
        sel = freqs[mask]
        sel = sel[sel > 0]
        if len(sel) > 0:
            return hz_to_midi(float(np.median(sel)))
    return 60


def get_pitch_frames_for_word(times, freqs, confs, start_sec, end_sec) -> list:
    mask = (times >= start_sec) & (times <= end_sec) & (confs > 0.1) & (freqs > 0)
    return [
        {
            "time": float(t),
            "midi": int(hz_to_midi(float(f))),
            "confidence": float(c),
        }
        for t, f, c in zip(times[mask], freqs[mask], confs[mask])
    ]


def add_pitch_to_words(raw_words, times, freqs, confs) -> list:
    words = []
    for w in raw_words:
        start = float(w["start"])
        end = float(w["end"])
        words.append({
            "word": str(w["word"]).strip(),
            "start": start,
            "end": end,
            "midi": get_midi_for_word(times, freqs, confs, start, end),
            "pitchFrames": get_pitch_frames_for_word(times, freqs, confs, start, end),
        })
    return words


def transcribe_with_whisperx(vocals_wav_path: str, prompt: str = "") -> tuple[list, str]:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, ".."))
    default_python = os.path.join(here, ".venv-whisperx", "Scripts", "python.exe")
    worker = os.path.join(here, "whisperx_worker.py")
    python_exe = os.environ.get("WHISPERX_PYTHON", default_python)

    if not os.path.exists(python_exe):
        raise RuntimeError(f"WhisperX Python not found: {python_exe}")
    if not os.path.exists(worker):
        raise RuntimeError(f"WhisperX worker not found: {worker}")

    env = os.environ.copy()
    env.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

    cmd = [
        python_exe,
        worker,
        "--audio", vocals_wav_path,
        "--model", WHISPERX_MODEL,
    ]
    language = os.environ.get("WHISPERX_LANGUAGE", "")
    if language:
        cmd.extend(["--language", language])
    if prompt:
        cmd.extend(["--prompt", prompt])

    proc = subprocess.run(
        cmd,
        cwd=root,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.stderr:
        print(proc.stderr.strip())
    if proc.returncode != 0:
        raise RuntimeError(f"WhisperX failed with code {proc.returncode}: {proc.stderr.strip()}")

    payload = json.loads(proc.stdout)
    return payload.get("words", []), payload.get("language") or language or "en"


def detect_pauses(
    vocals: np.ndarray,
    sr: int,
    frame_ms: int = 25,
    hop_ms: int = 10,
    min_silence_ms: int = 400,
    threshold_ratio: float = 0.05,
) -> list:
    """Detect silence regions in Demucs vocals via RMS energy. Returns [{start, end}] in seconds."""
    frame_len = int(sr * frame_ms / 1000)
    hop_len   = int(sr * hop_ms  / 1000)
    n_frames  = max(1, (len(vocals) - frame_len) // hop_len + 1)

    idx = np.arange(n_frames)[:, None] * hop_len + np.arange(frame_len)
    idx = np.clip(idx, 0, len(vocals) - 1)
    rms = np.sqrt((vocals[idx] ** 2).mean(axis=1))

    p95 = float(np.percentile(rms, 95))
    if p95 < 1e-6:
        return []

    is_silent  = rms < threshold_ratio * p95
    min_frames = max(1, round(min_silence_ms / hop_ms))
    times      = np.arange(n_frames, dtype=np.float32) * (hop_ms / 1000)

    pauses: list = []
    in_silence = False
    sil_start  = 0

    for i, silent in enumerate(is_silent):
        if silent and not in_silence:
            in_silence, sil_start = True, i
        elif not silent and in_silence:
            in_silence = False
            if i - sil_start >= min_frames:
                pauses.append({"start": float(times[sil_start]), "end": float(times[i])})

    if in_silence and n_frames - sil_start >= min_frames:
        pauses.append({"start": float(times[sil_start]), "end": float(times[n_frames - 1])})

    return pauses


# ── endpoint ──────────────────────────────────────────────────────────────────

HEARTBEAT_INTERVAL = 25  # seconds — keeps undici's 5-min bodyTimeout from firing


@app.post("/transcribe")
async def transcribe(mp3_path: str = Form(...), lyrics: str = Form("")):
    if not os.path.exists(mp3_path):
        raise HTTPException(status_code=404, detail=f"File not found: {mp3_path}")

    base = os.path.splitext(mp3_path)[0]
    vocals_mp3_path = base + "_vocals.mp3"
    acc_mp3_path    = base + "_accompaniment.mp3"
    vocals_wav_path = base + "_vocals.wav"

    async def generate():
        # All heavy work runs in a background task that pushes events into a queue.
        # The generator loop reads with a timeout and sends SSE keepalive comments
        # while the GPU is busy, preventing the client's HTTP layer from timing out.
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        async def worker():
            try:
                def load_audio():
                    data, sr = sf.read(mp3_path)
                    if data.ndim > 1:
                        data = data.mean(axis=1)
                    return data, sr

                audio, sr = await asyncio.to_thread(load_audio)

                await queue.put(sse("Separando voz de la música…"))
                vocals, accompaniment, out_sr = await asyncio.to_thread(separate_all, audio, sr)

                if DEVICE == "cuda":
                    torch.cuda.empty_cache()

                def save_stems():
                    with open(vocals_mp3_path, "wb") as f:
                        f.write(to_mp3_bytes(vocals, out_sr))
                    with open(acc_mp3_path, "wb") as f:
                        f.write(to_mp3_bytes(accompaniment, out_sr))
                    sf.write(vocals_wav_path, vocals, out_sr)

                await asyncio.to_thread(save_stems)

                await queue.put(sse("Detectando pitch con torchcrepe…"))
                times, freqs, confs = await asyncio.to_thread(analyze_pitch, vocals, out_sr)
                pct = 100 * (confs > 0.5).sum() / max(len(confs), 1)
                print(f"[transcribe] Pitch: {len(times)} frames, {pct:.0f}% confident")

                gc.collect()
                if DEVICE == "cuda":
                    torch.cuda.empty_cache()
                    print(f"[transcribe] VRAM after crepe: {torch.cuda.memory_allocated()//1024**2} MB allocated")

                pauses = await asyncio.to_thread(detect_pauses, vocals, out_sr)
                print(f"[transcribe] Pauses: {len(pauses)} silence regions detected")

                await queue.put(sse("Transcribiendo letra con Whisper…"))
                prompt = lyrics.strip() if lyrics.strip() else None

                def do_whisper():
                    # Runs on the Demucs vocals WAV (cleaner than the full mix).
                    if ALIGN_ENGINE == "whisperx":
                        raw_words, language = transcribe_with_whisperx(vocals_wav_path, prompt=prompt or "")
                        return add_pitch_to_words(raw_words, times, freqs, confs), language

                    segs, info = whisper_model.transcribe(
                        vocals_wav_path,
                        word_timestamps=True,
                        initial_prompt=prompt,
                        # Stops a bad segment from poisoning the next ones (repetition / drift in singing).
                        condition_on_previous_text=False,
                    )
                    raw_words = []
                    for seg in segs:
                        for w in seg.words:
                            raw_words.append({
                                "word": w.word.strip(),
                                "start": w.start,
                                "end": w.end,
                            })
                    return add_pitch_to_words(raw_words, times, freqs, confs), info.language

                words, language = await asyncio.to_thread(do_whisper)

                await queue.put(
                    "data: " + json.dumps({
                        "done": True,
                        "words": words,
                        "language": language,
                        "vocalsPath": vocals_mp3_path,
                        "accompanimentPath": acc_mp3_path,
                        "pauses": pauses,
                    }) + "\n\n"
                )

            except Exception as exc:
                print(f"[transcribe error] {exc}")
                await queue.put(f"data: {json.dumps({'error': str(exc)})}\n\n")

            finally:
                if os.path.exists(vocals_wav_path):
                    os.unlink(vocals_wav_path)
                await queue.put(None)  # sentinel

        task = asyncio.create_task(worker())

        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL)
                if item is None:
                    break
                yield item
            except asyncio.TimeoutError:
                # SSE comment — invisible to clients, resets socket idle timers
                yield ": keepalive\n\n"

        await task

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/health")
async def health():
    return {"status": "ok", "device": DEVICE, "model": WHISPER_MODEL, "demucs": DEMUCS_MODEL}
