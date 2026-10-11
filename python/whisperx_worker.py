import argparse
import contextlib
import json
import os
import sys
from pathlib import Path

import whisperx


def add_project_ffmpeg_to_path() -> None:
    root = Path(__file__).resolve().parents[1]
    matches = list(root.glob(
        "node_modules/.pnpm/@ffmpeg-installer+win32-x64@*/"
        "node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe"
    ))
    if not matches:
        return
    os.environ["PATH"] = str(matches[0].parent) + os.pathsep + os.environ.get("PATH", "")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--language", default=os.environ.get("WHISPERX_LANGUAGE", ""))
    parser.add_argument("--model", default=os.environ.get("WHISPERX_MODEL", "small"))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("WHISPERX_BATCH_SIZE", "4")))
    parser.add_argument("--prompt", default="")
    args = parser.parse_args()

    add_project_ffmpeg_to_path()

    import torch

    # Auto-pick the GPU when this venv has a CUDA build of torch; override with WHISPERX_DEVICE.
    device = os.environ.get("WHISPERX_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
    # float16 is only fast on compute capability >= 7.0 (Volta+); Pascal cards (GTX 10xx) do best with int8.
    fast_fp16 = device == "cuda" and torch.cuda.get_device_capability()[0] >= 7
    default_compute = "float16" if fast_fp16 else "int8"
    compute_type = os.environ.get("WHISPERX_COMPUTE_TYPE", default_compute)
    print(f"[whisperx] device={device} compute={compute_type} model={args.model}", file=sys.stderr)
    lang = args.language or None

    with contextlib.redirect_stdout(sys.stderr):
        audio = whisperx.load_audio(args.audio)
        model = whisperx.load_model(
            args.model,
            device,
            compute_type=compute_type,
            language=lang,
        )

        transcribe_kwargs = {
            "batch_size": args.batch_size,
            "language": lang,
        }
        # Try to pass initial_prompt — supported in some whisperx versions via **kwargs
        if args.prompt:
            try:
                result = model.transcribe(audio, **transcribe_kwargs, initial_prompt=args.prompt)
            except TypeError:
                # whisperx version doesn't support initial_prompt, fall back silently
                result = model.transcribe(audio, **transcribe_kwargs)
        else:
            result = model.transcribe(audio, **transcribe_kwargs)

        model_a, metadata = whisperx.load_align_model(
            language_code=result["language"],
            device=device,
        )
        result = whisperx.align(
            result["segments"],
            model_a,
            metadata,
            audio,
            device,
            return_char_alignments=False,
        )

    words = []
    for segment in result.get("segments", []):
        for word in segment.get("words", []):
            if "start" not in word or "end" not in word:
                continue
            text = str(word.get("word", "")).strip()
            if not text:
                continue
            words.append({
                "word": text,
                "start": float(word["start"]),
                "end": float(word["end"]),
            })

    json.dump({"language": result.get("language") or args.language, "words": words}, sys.stdout)


if __name__ == "__main__":
    main()
