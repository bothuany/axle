//! Flow desktop shell: starts the patched VS Code in server mode and shows it in a native window.
//! Deliberately thin: every product feature lives in the editor's built-in Flow extensions.
//! Runs on macOS, Linux and Windows.

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{Manager, RunEvent, Url};

struct Server(Mutex<Option<Child>>);

/// The VS Code checkout `npm run setup` prepares (editor/vscode), or FLOW_EDITOR to point elsewhere.
fn editor_root() -> PathBuf {
    if let Ok(dir) = std::env::var("FLOW_EDITOR") {
        return PathBuf::from(dir);
    }
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../editor/vscode");
    dir.canonicalize().unwrap_or(dir)
}

/// VS Code downloads its own Node into .build/node/<version>/<platform>-<arch>/node[.exe]; any `node` on PATH also works.
fn server_node(root: &Path) -> PathBuf {
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    std::fs::read_dir(root.join(".build/node"))
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|v| std::fs::read_dir(v.path()).ok().into_iter().flatten().flatten())
        .map(|p| p.path().join(exe))
        .find(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from(exe))
}

/// A macOS .app started from Finder gets a minimal PATH; borrow the login shell's so dotnet, node,
/// claude and codex resolve for the extension host and the terminals it spawns.
#[cfg(not(windows))]
fn fix_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    if let Ok(out) = Command::new(shell).args(["-lc", "echo $PATH"]).output() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        if let Some(path) = stdout.lines().rev().find(|l| l.contains('/')) {
            let home = std::env::var("HOME").unwrap_or_default();
            // SAFETY: called once at startup before any threads are spawned.
            unsafe { std::env::set_var("PATH", format!("{home}/.dotnet:{}", path.trim())) };
        }
    }
}

#[cfg(windows)]
fn fix_path() {}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(8765)
}

fn token() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("no system randomness");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Where the running server's pid is kept, so a shell that was killed (not quit) can clean up next time.
fn pid_file() -> PathBuf {
    std::env::temp_dir().join("flow-editor-server.pid")
}

/// Ends a process and everything it started (extension hosts, terminals, language servers).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    #[cfg(not(windows))]
    {
        // The server runs in its own process group (see start_server): signal the whole group.
        // SAFETY: plain signal to a process group we created.
        unsafe { libc::killpg(pid as i32, libc::SIGTERM) };
    }
}

fn kill_stale_server() {
    if let Ok(text) = std::fs::read_to_string(pid_file()) {
        if let Ok(pid) = text.trim().parse::<u32>() {
            kill_tree(pid);
        }
        let _ = std::fs::remove_file(pid_file());
    }
}

fn start_server(port: u16, token: &str) -> Result<Child, String> {
    let root = editor_root();
    if !root.join("scripts/code-server.js").exists() {
        return Err(format!("The editor is not set up at {}: run `npm run setup` in the repository first.", root.display()));
    }
    kill_stale_server();
    let mut cmd = Command::new(server_node(&root));
    cmd.arg(root.join("scripts/code-server.js"))
        .args(["--host", "127.0.0.1", "--port", &port.to_string()])
        .args(["--connection-token", token, "--accept-server-license-terms"])
        // A reloaded window leaves its old extension host behind for the grace time (3 hours by
        // default), still holding ports and IDE lock files. One minute covers sleep and reconnects.
        .args(["--reconnection-grace-time", "60"])
        .env("NODE_ENV", "development")
        .env("VSCODE_DEV", "1")
        .current_dir(&root)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        // Own process group, so quitting ends the server *and* its extension hosts and terminals.
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| format!("Could not start the editor server: {e}"))?;
    let _ = std::fs::write(pid_file(), child.id().to_string());
    Ok(child)
}

fn wait_ready(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

fn kill_server(app: &tauri::AppHandle) {
    if let Some(child) = app.state::<Server>().0.lock().unwrap().take() {
        kill_tree(child.id());
        let _ = std::fs::remove_file(pid_file());
    }
}

/// An Edit menu makes copy/paste work in the webview on macOS. No Close item: the editor owns Cmd/Ctrl+W.
fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = Submenu::with_items(app, "Flow", true, &[
        &PredefinedMenuItem::about(app, None, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, None)?,
        &PredefinedMenuItem::quit(app, None)?,
    ])?;
    let edit = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;
    let window = Submenu::with_items(app, "Window", true, &[
        &PredefinedMenuItem::minimize(app, None)?,
        &PredefinedMenuItem::fullscreen(app, None)?,
    ])?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_path();
    // A folder to open: the first argument or FLOW_FOLDER. Without one, Flow starts on its Home page.
    let folder = std::env::args().nth(1).or_else(|| std::env::var("FLOW_FOLDER").ok());

    let mut builder = tauri::Builder::default().manage(Server(Mutex::new(None)));
    // Windows and Linux keep their own window chrome; the app menu is a macOS convention.
    if cfg!(target_os = "macos") {
        builder = builder.menu(menu);
    }
    builder
        .setup(move |app| {
            let port = free_port();
            let tkn = token();
            let handle = app.handle().clone();
            let started = start_server(port, &tkn);
            let error = started.as_ref().err().cloned();
            if let Ok(child) = started {
                app.state::<Server>().0.lock().unwrap().replace(child);
            }
            std::thread::spawn(move || {
                let Some(win) = handle.get_webview_window("main") else { return };
                let fail = |msg: &str| {
                    let js = format!("document.getElementById('m').id='e';document.getElementById('e').textContent={};", serde_json::to_string(msg).unwrap());
                    let _ = win.eval(&js);
                };
                if let Some(e) = error {
                    return fail(&e);
                }
                if !wait_ready(port) {
                    return fail("The editor server did not start within 3 minutes.");
                }
                let mut url = Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap();
                url.query_pairs_mut().append_pair("tkn", &tkn);
                if let Some(f) = &folder {
                    // The server takes a URI path: C:\\work\\app becomes /C:/work/app.
                    let p = f.replace('\\', "/");
                    let p = if p.starts_with('/') { p } else { format!("/{p}") };
                    url.query_pairs_mut().append_pair("folder", &p);
                }
                let _ = win.navigate(url);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                kill_server(app);
            }
        });
}
