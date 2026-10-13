// Desktop shell: starts the bundled Next.js server (with the bundled Node) on a free local port,
// shows a splash while it boots, then points the window at it. Python, models and the
// transcription service are managed by the web app itself (first-run installer + on-demand start).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, RunEvent, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const BOOT_TIMEOUT: Duration = Duration::from_secs(90);

struct Server(Mutex<Option<Child>>);

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(3010)
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

/// Windows can hand back `\\?\C:\...` paths; Node and Python are happier without the prefix.
fn plain(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p,
    }
}

/// Kills the server and everything it started (the Python service is its child).
fn kill_tree(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    let _ = child.kill();
}

/// Windows Job Object that kills every process in it when the shell exits for any reason
/// (including being force-killed), so Node and the Python service never outlive the window.
mod job {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Puts `child` (and, by inheritance, its children) in a kill-on-close job. The job handle is
    /// intentionally never closed: it must live exactly as long as this process.
    pub fn adopt(child: &Child) {
        unsafe {
            let job: HANDLE = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok != 0 {
                AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE);
            }
        }
    }
}

fn start_server(resources: &Path, data: &Path, port: u16) -> std::io::Result<Child> {
    let node = std::env::current_exe()?
        .parent()
        .map(|d| d.join("node.exe"))
        .unwrap_or_else(|| PathBuf::from("node.exe"));

    // A GUI process has no console, so keep the server's output in a log file (useful for support).
    let log_dir = data.join("logs");
    std::fs::create_dir_all(&log_dir)?;
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("server.log"))?;
    let log_err = log.try_clone()?;

    let child = Command::new(node)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .arg("server.js")
        .current_dir(resources.join("app"))
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("ULTRASONGS_HOME", data)
        .env("ULTRASONGS_PYTHON_SRC", resources.join("python"))
        .env("TMP_DIR", data.join("tmp"))
        .env("DRAFTS_DIR", data.join("drafts"))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;

    job::adopt(&child);
    Ok(child)
}

/// Stops the server (and the Python service under it): the installer replaces files they may hold open.
fn stop_server(app: &AppHandle) {
    if let Some(server) = app.try_state::<Server>() {
        if let Some(child) = server.0.lock().unwrap().as_mut() {
            kill_tree(child);
        }
    }
}

/// Tells the web UI how the update is going (`UpdateProgress` listens): `phase` is "downloading",
/// "installing" or "error"; `total` is unknown when the server sends no Content-Length.
fn emit_update(app: &AppHandle, phase: &str, downloaded: u64, total: Option<u64>) {
    let _ = app.emit(
        "update-progress",
        serde_json::json!({ "phase": phase, "downloaded": downloaded, "total": total }),
    );
}

/// Downloads `update`, stops the server and runs the installer; the app then restarts.
async fn install_and_restart(
    app: &AppHandle,
    update: Update,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    emit_update(app, "downloading", 0, None);
    let mut downloaded: u64 = 0;
    let mut last_step: u64 = u64::MAX;
    let progress_app = app.clone();
    let result = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                // About 100 events for the whole download, not one per network chunk
                let step = total.map_or(downloaded / (256 * 1024), |t| downloaded * 100 / t.max(1));
                if step != last_step {
                    last_step = step;
                    emit_update(&progress_app, "downloading", downloaded, total);
                }
            },
            || {},
        )
        .await;
    let bytes = match result {
        Ok(bytes) => bytes,
        Err(e) => {
            emit_update(app, "error", 0, None);
            return Err(e.into());
        }
    };
    emit_update(app, "installing", 0, None);
    stop_server(app);
    // The installer replaces files and the app exits right after launching it; a moment lets the
    // "installing" notice reach the screen instead of the window just vanishing.
    std::thread::sleep(Duration::from_millis(800));
    if let Err(e) = update.install(bytes) {
        emit_update(app, "error", 0, None);
        return Err(e.into());
    }
    app.restart();
}

/// Settings screen: is a newer version published? Returns `{ available, version?, current }`.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<serde_json::Value, String> {
    let current = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(match update {
        Some(u) => serde_json::json!({ "available": true, "version": u.version, "current": current }),
        None => serde_json::json!({ "available": false, "current": current }),
    })
}

/// Settings screen: install the newer version (the app restarts when it is done).
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    match update {
        Some(update) => install_and_restart(&app, update).await.map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Decodes the `%XX` escapes of a URI component (the file name travels in a header).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Download button: the webview does not save blob downloads, so the page sends the bytes here
/// (raw body, file name in the `x-filename` header), the user picks where, and the file is written.
/// Returns the saved path, or null if the dialog was cancelled.
#[tauri::command]
async fn save_download(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let name = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "song.zip".into());
    // Never trust a path from the page: only the file name is used as a suggestion.
    let name = Path::new(&name)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "song.zip".into());

    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("ZIP", &["zip"])
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Opens a link in the default browser. Only a short list of hosts the credits point at is allowed,
/// since the webview shows a local web app and must not be able to launch arbitrary URLs.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed: Url = url.parse().map_err(|_| "invalid url".to_string())?;
    let allowed = parsed.scheme() == "https"
        && matches!(
            parsed.host_str().unwrap_or(""),
            "github.com" | "www.github.com" | "ultrastar-es.org" | "www.ultrastar-es.org"
        );
    if !allowed {
        return Err("url not allowed".into());
    }
    Command::new("explorer.exe")
        .arg(parsed.as_str())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Looks for a newer release (manifest: `latest.json` in the repository) and, if the user agrees,
/// downloads it, stops the server and runs the installer. Any failure is silent: being offline or
/// GitHub being down must never get in the way of using the app.
async fn update_if_available(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    let message = format!(
        "Hay una versión nueva de Ultrasongs ({new}). Tenés la {old}.
         Tus borradores y modelos no se tocan. ¿Instalarla ahora?

         A new version of Ultrasongs is available ({new}; you have {old}).
         Your drafts and models are kept. Install it now?",
        new = update.version,
        old = update.current_version,
    );
    let accepted = app
        .dialog()
        .message(message)
        .title("Ultrasongs")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Instalar / Install".into(),
            "Más tarde / Later".into(),
        ))
        .blocking_show();
    if !accepted {
        return Ok(());
    }
    if let Err(e) = install_and_restart(&app, update).await {
        // The user said yes and then nothing happened: say so instead of failing silently
        app.dialog()
            .message(format!(
                "No se pudo instalar la actualización. Intentá de nuevo más tarde.\n\
                 The update could not be installed. Please try again later.\n\n{e}"
            ))
            .title("Ultrasongs")
            .blocking_show();
    }
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![check_update, install_update, open_external, save_download])
        .setup(|app| {
            let resources = plain(app.path().resource_dir()?);
            // Not the install folder (%LOCALAPPDATA%\Ultrasongs): uninstalling must not wipe models and drafts.
            let data = plain(app.path().app_local_data_dir()?);
            std::fs::create_dir_all(&data)?;

            let port = free_port();
            let child = start_server(&resources, &data, port)?;
            app.manage(Server(Mutex::new(Some(child))));

            // Checked a little after startup, so it never competes with the server booting.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(10));
                let _ = tauri::async_runtime::block_on(update_if_available(handle));
            });

            let window = app.get_webview_window("main");
            std::thread::spawn(move || {
                let Some(window) = window else { return };
                if wait_for_port(port, BOOT_TIMEOUT) {
                    if let Ok(url) = format!("http://127.0.0.1:{port}").parse::<Url>() {
                        let _ = window.navigate(url);
                    }
                } else {
                    let _ = window.eval(
                        "document.body.innerHTML = '<p style=\"font-family:sans-serif;padding:2rem\">\
                         No se pudo iniciar Ultrasongs. Cerrá la ventana y volvé a abrirla.</p>'",
                    );
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(server) = handle.try_state::<Server>() {
                if let Some(child) = server.0.lock().unwrap().as_mut() {
                    kill_tree(child);
                }
            }
        }
    });
}
