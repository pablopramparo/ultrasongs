"""Pre-downloads the models the pipeline needs, so the first transcription doesn't stall.

Prints one JSON object per line ({"stage": ..., "done": bool}) for the installer to relay.
HF_HOME / TORCH_HOME decide where files land (set by the host app).
"""
import argparse
import json
import sys

import hf_compat  # noqa: F401 - patches huggingface_hub before any download


def emit(stage: str, done: bool = False, error: str | None = None, key: str | None = None, **vars) -> None:
    """One JSON line. `key`/`vars` name the UI translation; `stage` is the Spanish fallback."""
    payload = {"stage": stage, "done": done}
    if error:
        payload["error"] = error
    if key:
        payload["key"] = key
        payload["vars"] = vars
    print(json.dumps(payload), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--whisper-model", default="medium")
    parser.add_argument("--languages", default="en", help="comma-separated alignment languages")
    args = parser.parse_args()

    try:
        emit(f"Descargando modelo Whisper ({args.whisper_model})", key="setup.ev.modelWhisper", model=args.whisper_model)
        from huggingface_hub import snapshot_download

        snapshot_download(repo_id=f"Systran/faster-whisper-{args.whisper_model}")

        emit("Descargando modelo de separación de voz (Demucs)", key="setup.ev.modelDemucs")
        from demucs.pretrained import get_model

        get_model("htdemucs")

        import whisperx

        for lang in [x.strip() for x in args.languages.split(",") if x.strip()]:
            emit(f"Descargando modelo de alineación ({lang})", key="setup.ev.modelAlign", lang=lang)
            whisperx.load_align_model(language_code=lang, device="cpu")

        emit("Modelos listos", done=True, key="setup.ev.modelsReady")
    except Exception as exc:  # noqa: BLE001 - surfaced to the installer UI
        emit("Error descargando modelos", error=f"{type(exc).__name__}: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
