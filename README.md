<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/ultrasong.png">
    <source media="(prefers-color-scheme: light)" srcset="public/ultrasong-dark.png">
    <img alt="Ultrasongs" src="public/ultrasong-dark.png" width="380">
  </picture>
</p>

<p align="center">
  Generate <a href="https://ultrastar-deluxe.org/">Ultrastar Deluxe</a> song files from an audio or video file and its lyrics.<br>
  Everything runs on your own machine — no external AI services.
</p>

> **Work in progress** — functional, but rough around the edges.

**Pipeline:** Demucs vocal separation → torchcrepe pitch detection → Whisper/WhisperX transcription → fuzzy lyric alignment → BPM-based beat mapping → Ultrastar `.txt`, with a visual timeline editor to fine-tune the result.

> **Hardware matters.** With an NVIDIA GPU a 4-minute song takes about a minute. **Without one the pipeline runs on the CPU and is slow** — roughly 5× the length of the audio in our test (a 4-minute song: 20 minutes or more). It works, but plan accordingly. See [Performance](#performance).

## Contents

- [Features](#features)
- [Windows installer](#windows-installer)
- [Run from source](#run-from-source)
- [Settings and languages](#settings-and-languages)
- [How it works](#how-it-works)
- [Performance](#performance)
- [Configuration reference](#configuration-reference)
- [Tech stack](#tech-stack)
- [Ultrastar .txt format](#ultrastar-txt-format)
- [Credits](#credits) · [License](#license)

## Features

- **Any source:** upload audio or video (MP3, MP4, MKV, FLAC, WAV, …) or paste a YouTube link (optional, can be disabled at build time).
- **Automatic vocal separation** with [Demucs](https://github.com/facebookresearch/demucs) `htdemucs`.
- **Per-word pitch** with [torchcrepe](https://github.com/maxrmorrison/torchcrepe), a neural estimator tuned for singing.
- **Transcription** with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), biased by your lyrics, plus optional [WhisperX](https://github.com/m-bain/whisperX) forced alignment for tighter word timing.
- **Lyric alignment** — fuzzy Levenshtein match of the transcription to your lyrics, syllable splitting for 20+ languages, BPM detection and beat-accurate note placement.
- **Timeline editor** — piano roll with audio and video playback, per-note editing, separate music/notes volume, and real-time microphone pitch tracking.
- **Songs library** — browse and import the songs already in your Ultrastar `Songs` folder, and write finished songs straight into it.
- **Drafts** — every processed song is saved automatically so you can come back to it.
- **English and Spanish** interface.

## Windows installer

`pnpm tauri:build` produces `src-tauri/target/release/bundle/nsis/Ultrasongs_<version>_x64-setup.exe` (about 50 MB). It is a [Tauri](https://tauri.app/) shell that starts the bundled Next.js server (with its own Node) and shows it in a native window.

**The installer is small on purpose.** Python, PyTorch and the AI models are downloaded the first time the app starts, from a progress screen:

| Step | Size | Notes |
| --- | --- | --- |
| Python 3.12 (portable) | ~45 MB | from `astral-sh/python-build-standalone` |
| PyTorch | ~3 GB with an NVIDIA GPU, ~200 MB CPU-only | picked automatically from `nvidia-smi` |
| Other packages | ~1 GB | pinned in `python/requirements.lock.txt` |
| Models | 0.5–3 GB | Whisper (`medium` on GPU, `small` on CPU), Demucs, alignment |

An internet connection is needed for that first run only.

- **No NVIDIA GPU:** the first-run screen says so and asks you to confirm before downloading anything. Processing then runs on the CPU, about 5× slower than the audio.
- **Not code-signed.** Windows SmartScreen warns on first launch ("Windows protected your PC"): choose *More info* → *Run anyway*.
- **Where things live:** the program in `%LOCALAPPDATA%\Ultrasongs`; Python, models, drafts and settings in `%LOCALAPPDATA%\com.ultrasongs.app`. They are kept apart so uninstalling the program does not delete your drafts or the multi-GB models.
- **Songs folder:** choose your Ultrastar `Songs` folder in *Settings*. Finished songs are written there as `Artist - Title/`; folders the app did not create are never overwritten.

Build flags: `NEXT_PUBLIC_ENABLE_YOUTUBE=0` removes the YouTube downloader from the build; `ULTRASONGS_FORCE_DEVICE=cpu` makes the installer skip the CUDA build (testing, or a broken NVIDIA driver).

## Run from source

### Requirements

- Node.js 20+ and [pnpm](https://pnpm.io/)
- Python 3.12 (the versions in `python/requirements.lock.txt` were tested on it)
- An NVIDIA GPU is strongly recommended; any CUDA-capable card works (development used a GTX 1080)
- Disk: about 7.5 GB for the Python environment (PyTorch CUDA is ~3 GB) plus 0.5–3 GB per Whisper model

FFmpeg needs no separate install: it comes with `@ffmpeg-installer/ffmpeg`.

### Setup

```bash
# 1. Node dependencies
pnpm install

# 2. Python environment (one virtualenv runs everything)
python -m venv python/.venv
python/.venv/Scripts/python -m pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu126   # CPU: .../whl/cpu
python/.venv/Scripts/python -m pip install -r python/requirements.lock.txt

# 3. Configuration (the defaults work out of the box)
cp .env.example .env.local
```

The app uses `python/.venv` automatically when it exists and falls back to `python` on `PATH`.

### Run

```bash
pnpm dev:all   # Next.js (port 3000) + Python service (port 8001)
```

or separately:

```bash
pnpm dev                                                           # Next.js only
cd python && python -m uvicorn transcribe_service:app --port 8001  # Python only
```

`pnpm dev:all` checks whether port 8001 is already listening before starting uvicorn, so it is safe to run repeatedly. For a production build run `pnpm build` and then `pnpm start:all` (or `start.bat` on Windows).

## Settings and languages

The sidebar has a **Settings** entry with two options:

- **Language** — Español / English. The choice is kept in a cookie, so it survives restarts and the first paint is already in the right language. With no choice made, the browser's language is used (Spanish by default).
- **Songs folder** — your Ultrastar `Songs` folder. The desktop app opens the native folder picker. `SONGS_DIR` in `.env.local` overrides it and locks the control.

### Translations

All interface text lives in `app/i18n/es.json` and `app/i18n/en.json` (flat `"area.key": "text"` pairs with `{name}` placeholders). Components use `const { t } = useI18n(); t("key", { name })`.

To add a language, create `app/i18n/<code>.json` with the same keys and register it in `app/i18n/index.ts` (`Lang`, `LANGUAGES`, `messages`); the build fails if a language is missing a key. Messages produced by the Python service and the first-run installer travel as keys and are translated in the browser. API errors are translated on the server from the language cookie: routes answer `{ message, code }` through `apiError()` / `apiFailure()` (`app/lib/apiResponse.ts`) and library code throws `AppError(key, vars)` (`app/lib/appError.ts`) instead of fixed text. Raw technical details (pip output, third-party messages) are shown as they come.

## How it works

```
Upload / YouTube
  └─ FFmpeg: any format → mono 128 kbps MP3

Transcribe (Python service, streamed to the browser over SSE)
  ├─ Demucs:      separate vocals and accompaniment
  ├─ torchcrepe:  pitch analysis on the vocals
  ├─ Pauses:      RMS silence regions
  └─ Whisper / WhisperX: transcribe the vocals, prompted by your lyrics

Generate
  ├─ Auto:   alignLyrics() → BPM detection → ms to beats → .txt
  └─ Editor: timeline notes → .txt  (line breaks inferred from pauses)
```

**WhisperX forced alignment.** Plain Whisper timestamps drift by ±100–300 ms. With `ALIGN_ENGINE=whisperx` the service runs [WhisperX](https://github.com/m-bain/whisperX) (wav2vec2 forced alignment) in a worker process that shares the service's environment (`WHISPERX_PYTHON` points it at a separate interpreter instead). The worker uses CUDA when available; `WHISPERX_DEVICE` and `WHISPERX_COMPUTE_TYPE` override that, and pre-Volta cards such as the GTX 1080 default to `int8`.

## Performance

| Hardware | Whisper model | Measured |
| --- | --- | --- |
| NVIDIA GTX 1080 (8 GB VRAM) | `medium` | ~75 s for a 4-minute song (Demucs + torchcrepe + WhisperX) |
| CPU only | `small` | ~220 s for a 40-second clip, i.e. **~5.5× the audio length** (a 4-minute song: ~20 minutes) |

The CPU figure comes from one machine and varies with the processor; read it as an order of magnitude. Demucs and Whisper are the slow parts. For tighter VRAM budgets use `WHISPER_MODEL=large-v3` (`int8_float16` compute).

## Configuration reference

Set these in `.env.local` (see `.env.example`). All are optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PYTHON_SERVICE_URL` | `http://localhost:8001` | Where Next.js reaches the transcription service |
| `TMP_DIR` | `./tmp` | Uploads, converted audio and separated stems |
| `DRAFTS_DIR` | `./drafts` | Saved drafts |
| `SONGS_DIR` | — | Ultrastar `Songs` folder; finished songs are also written here (overrides the Settings value) |
| `ALIGN_ENGINE` | `whisper` | `whisperx` for forced alignment (recommended) |
| `WHISPER_MODEL` | `medium` | faster-whisper model when `ALIGN_ENGINE=whisper` |
| `WHISPERX_MODEL` | `small` | Whisper model WhisperX uses |
| `WHISPERX_LANGUAGE` | auto | Force the transcription language |
| `WHISPERX_USE_PROMPT` | off | `1` biases WhisperX with your lyrics |
| `WHISPERX_DEVICE`, `WHISPERX_COMPUTE_TYPE`, `WHISPERX_BATCH_SIZE` | auto | Worker tuning |
| `WHISPERX_PYTHON` | same interpreter | Run WhisperX in a separate environment |
| `DEMUCS_MODEL` | `htdemucs` | e.g. `htdemucs_ft` for cleaner vocals at ~4× the time |
| `YTDLP_PYTHON` | project venv | Interpreter that has `yt-dlp` |
| `NEXT_PUBLIC_ENABLE_YOUTUBE` | on | `0` removes the YouTube downloader (build time) |
| `ULTRASONGS_HOME` | `%LOCALAPPDATA%\com.ultrasongs.app` | Python, models, settings (installed app) |
| `ULTRASONGS_FORCE_DEVICE` | auto | `cpu` makes the installer skip the CUDA build |

## Tech stack

| Layer | Technology |
| --- | --- |
| App | Next.js 16 (App Router), TypeScript strict, Tailwind CSS v4 |
| Desktop shell | Tauri 2 (Rust), NSIS installer |
| Audio extraction | FFmpeg via `fluent-ffmpeg` |
| Vocal separation | Demucs `htdemucs` (Python) |
| Transcription / alignment | faster-whisper, WhisperX (Python) |
| Pitch detection | torchcrepe (Python) |
| YouTube download | yt-dlp (Python) |
| BPM detection | `music-tempo` |
| Syllabification | `hyphen` (TeX patterns) |
| ZIP export | JSZip |
| Package manager | pnpm |

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

- `:` normal note · `*` golden note (star) · `F` freestyle (not sung or scored) · `R` rap · `G` golden rap · `-` line break · `E` end of song
- Note: `[type] [start_beat] [duration_beats] [midi_pitch] [syllable]`
- `GAP` = milliseconds before beat 0; beat formula: `((ms − GAP) / 1000) × (BPM / 60) × 4`

## Credits

Built by [Pablo Pramparo](https://github.com/pablopramparo).

Powered by [Demucs](https://github.com/facebookresearch/demucs) (Meta Research), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [WhisperX](https://github.com/m-bain/whisperX), [torchcrepe](https://github.com/maxrmorrison/torchcrepe) and [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## License

MIT
