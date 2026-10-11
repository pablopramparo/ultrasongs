# Ultrasongs

> **Work in progress** — functional but rough around the edges.

Generate [Ultrastar Deluxe](https://ultrastar-deluxe.org/) compatible `.txt` song files from any audio or video file + song lyrics. Runs fully local — no external AI APIs required.

**Pipeline:** Demucs vocal separation → torchcrepe pitch detection → faster-whisper transcription → fuzzy lyric alignment → BPM-based beat mapping → `.txt` export with optional visual timeline editor.

**Runs in the browser** — no desktop app to install. Clone the repo, run two commands, open `localhost:3000`.

## Features

- Runs in the browser — no installer, no Electron, no desktop app
- Upload any audio or video format (MP4, MKV, MP3, FLAC, WAV, …)
- Automatic vocal separation via [Demucs](https://github.com/facebookresearch/demucs) `htdemucs`
- Per-word MIDI pitch via [torchcrepe](https://github.com/maxrmorrison/torchcrepe) — neural pitch estimation tuned for singing voices
- Transcription via [faster-whisper](https://github.com/SYSTRAN/faster-whisper), biased by your provided lyrics
- Fuzzy Levenshtein alignment of Whisper words → user lyrics
- BPM detection + beat-accurate note placement
- Syllable splitting (20+ languages via TeX hyphenation patterns)
- Visual timeline editor with audio playback, per-note preview, and real-time microphone pitch tracking
- ZIP download with `.txt` + separated audio tracks

## Requirements

- Node.js 20+ and [pnpm](https://pnpm.io/)
- Python 3.10+
- [FFmpeg](https://ffmpeg.org/) (or install via `@ffmpeg-installer/ffmpeg` — already in `package.json`)
- PyTorch with CUDA recommended (CPU works but is slow)

### Python dependencies

```bash
pip install faster-whisper torchcrepe torch torchaudio demucs lameenc soundfile fastapi uvicorn python-multipart
```

## Setup

```bash
# 1. Install Node dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local if needed (defaults work out of the box)
```

`.env.local` defaults:

```
PYTHON_SERVICE_URL=http://localhost:8001
TMP_DIR=./tmp
```

## Running

```bash
pnpm dev:all   # Starts Next.js (port 3000) + Python service (port 8001) together
```

Or start them separately:

```bash
pnpm dev                                                           # Next.js only
cd python && python -m uvicorn transcribe_service:app --port 8001  # Python only
```

`pnpm dev:all` checks if port 8001 is already listening before spawning uvicorn, so it's safe to run repeatedly.

## Pipeline

```
Upload
  └─ FFmpeg: any format → mono 128 kbps MP3

Transcribe (Python microservice via SSE stream)
  ├─ Demucs:    separate vocals + accompaniment
  ├─ torchcrepe: pitch analysis on vocals track
  ├─ Pause detection: RMS silence regions
  └─ Whisper:   transcribe vocals, prompted by user lyrics

Generate
  ├─ Mode A (auto):   alignLyrics() → BPM detect → msToBeats → .txt
  └─ Mode B (editor): TimelineEditor notes (already in beat format) → .txt
```

## Tech stack

| Layer            | Technology                                 |
| ---------------- | ------------------------------------------ |
| Framework        | Next.js 16 + App Router, TypeScript strict |
| Styling          | Tailwind CSS v4                            |
| Audio extraction | FFmpeg via `fluent-ffmpeg`                 |
| Vocal separation | Demucs `htdemucs` (Python)                 |
| Transcription    | faster-whisper (Python)                    |
| Pitch detection  | torchcrepe (Python)                        |
| BPM detection    | `music-tempo`                              |
| Syllabification  | `hyphen` (TeX patterns)                    |
| ZIP export       | JSZip                                      |
| Package manager  | pnpm                                       |

## Performance

Tested on an NVIDIA GTX 1080 (8 GB VRAM). A 4-minute song takes roughly 40–60 s (Demucs + torchcrepe + Whisper running sequentially).

Default Whisper model: `medium`. For tighter VRAM budgets, set `WHISPER_MODEL=large-v3` to use `int8_float16` compute.

### WhisperX forced alignment (more accurate word timing)

Plain Whisper timestamps drift by ±100–300 ms. With `ALIGN_ENGINE=whisperx` the service runs [WhisperX](https://github.com/m-bain/whisperX) (wav2vec2 forced alignment) in its own virtualenv at `python/.venv-whisperx`, which is gitignored.

```bash
python -m venv python/.venv-whisperx
python/.venv-whisperx/Scripts/python -m pip install whisperx
# GPU build of torch (the default wheel is CPU-only and ~6x slower):
python/.venv-whisperx/Scripts/python -m pip install --no-deps --force-reinstall "torch==2.8.0+cu126" "torchaudio==2.8.0+cu126" --index-url https://download.pytorch.org/whl/cu126
```

The worker picks CUDA automatically when available (`WHISPERX_DEVICE`, `WHISPERX_COMPUTE_TYPE` override it; pre-Volta cards such as the GTX 1080 default to `int8`). On a GTX 1080 a 3-minute vocals track aligns in ~23 s on GPU vs ~142 s on CPU.

## Ultrastar .txt format

```
#TITLE:Song Title
#ARTIST:Artist Name
#MP3:song.mp3
#BPM:120
#GAP:1200
: 0 4 60 Hel-
: 4 4 62 lo
- 16
: 20 4 60 World
E
```

- `:` normal note · `*` golden note · `-` line break · `E` end of song
- Note: `[type] [start_beat] [duration_beats] [midi_pitch] [syllable]`
- `GAP` = milliseconds before beat 0; beat formula: `((ms − GAP) / 1000) × (BPM / 60) × 4`

## Credits

Built by [Pablo Pramparo](https://github.com/pablopramparo).

Powered by:

- [Demucs](https://github.com/facebookresearch/demucs) — vocal separation (Meta Research)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — speech transcription
- [torchcrepe](https://github.com/maxrmorrison/torchcrepe) — pitch estimation

## License

MIT
