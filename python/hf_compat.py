"""Windows fix for huggingface_hub's symlink probe.

`are_symlinks_supported()` records "supported" *before* it actually tests, so when several download
threads start at once (snapshot_download), the others read that provisional value, try a symlink and
fail with WinError 1314 on machines without Developer Mode / admin rights. Serialising the probe
makes the first caller finish it before anyone else reads the result; files are then copied instead
of symlinked, which is what huggingface_hub already does when it knows symlinks aren't available.
"""
import threading


def apply() -> None:
    try:
        import huggingface_hub.file_download as fd
    except Exception:  # noqa: BLE001 - nothing to patch if the package isn't importable
        return

    if getattr(fd, "_ultrasongs_patched", False):
        return

    original = fd.are_symlinks_supported
    lock = threading.Lock()

    def safe(cache_dir=None):
        with lock:
            return original(cache_dir)

    fd.are_symlinks_supported = safe
    fd._ultrasongs_patched = True


apply()
