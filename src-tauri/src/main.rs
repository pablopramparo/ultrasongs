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

use tauri::{AppHandle, Manager, RunEvent, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

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
    let bytes = update.download(|_, _| {}, || {}).await?;
    // The installer replaces files the server (and the Python service) may be holding open.
    if let Some(server) = app.try_state::<Server>() {
        if let Some(child) = server.0.lock().unwrap().as_mut() {
            kill_tree(child);
        }
    }
    update.install(bytes)?;
    app.restart();
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
