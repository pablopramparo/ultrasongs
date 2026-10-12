fn main() {
    // The web app runs from a local http origin, which Tauri treats as remote: it may only call the
    // commands listed here and granted in capabilities/default.json (allow-<command-name>).
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["check_update", "install_update", "open_external", "save_download"]),
        ),
    )
    .expect("failed to run tauri-build");
}
