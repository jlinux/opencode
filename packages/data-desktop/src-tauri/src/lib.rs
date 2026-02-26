mod cli;
mod server;

use futures::future::{self, Shared};
use std::{
    net::TcpListener,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, RunEvent};
use tokio::{
    sync::{oneshot, watch},
    time::timeout,
};

use crate::cli::CommandChild;

#[derive(Clone, serde::Serialize, Debug)]
pub struct ServerReadyData {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub is_sidecar: bool,
}

#[derive(Clone, Copy, serde::Serialize, Debug)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum InitStep {
    ServerWaiting,
    SqliteWaiting,
    Done,
}

struct InitState {
    current: watch::Receiver<InitStep>,
}

#[derive(Clone)]
struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    status: Shared<oneshot::Receiver<Result<ServerReadyData, String>>>,
}

impl ServerState {
    pub fn new(
        child: Option<CommandChild>,
        status: Shared<oneshot::Receiver<Result<ServerReadyData, String>>>,
    ) -> Self {
        Self {
            child: Arc::new(Mutex::new(child)),
            status,
        }
    }
}

#[tauri::command]
fn kill_sidecar(app: AppHandle) {
    let Some(server_state) = app.try_state::<ServerState>() else {
        tracing::info!("Server not running");
        return;
    };

    if let Some(child) = server_state
        .child
        .lock()
        .expect("mutex lock")
        .take()
    {
        let _ = child.kill();
        tracing::info!("Killed server");
    }
}

#[tauri::command]
async fn await_initialization(
    state: tauri::State<'_, ServerState>,
    init_state: tauri::State<'_, InitState>,
    events: tauri::ipc::Channel<InitStep>,
) -> Result<ServerReadyData, String> {
    let mut rx = init_state.current.clone();

    let events_task = async {
        let e = *rx.borrow();
        let _ = events.send(e);

        while rx.changed().await.is_ok() {
            let step = *rx.borrow_and_update();
            let _ = events.send(step);
            if matches!(step, InitStep::Done) {
                break;
            }
        }
    };

    future::join(state.status.clone(), events_task)
        .await
        .0
        .map_err(|_| "Failed to get server status".to_string())?
}

pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            kill_sidecar,
            await_initialization,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(initialize(handle));
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                tracing::info!("Received Exit");
                kill_sidecar(app.clone());
            }
        });
}

async fn initialize(app: AppHandle) {
    tracing::info!("Initializing data-desktop app");

    let (init_tx, init_rx) = watch::channel(InitStep::ServerWaiting);
    app.manage(InitState { current: init_rx });

    let (server_ready_tx, server_ready_rx) = oneshot::channel();
    let server_ready_rx = futures::FutureExt::shared(server_ready_rx);
    app.manage(ServerState::new(None, server_ready_rx));

    // Try to connect to existing server or spawn sidecar
    tokio::spawn(async move {
        match setup_server_connection(&app).await {
            Ok(data) => {
                let _ = init_tx.send(InitStep::Done);
                let _ = server_ready_tx.send(Ok(data));
            }
            Err(e) => {
                let _ = server_ready_tx.send(Err(e));
            }
        }
    });
}

async fn setup_server_connection(app: &AppHandle) -> Result<ServerReadyData, String> {
    // First check for a custom server URL
    if let Some(url) = server::get_saved_server_url(app).await {
        if server::check_health(&url, None, None).await.is_ok() {
            return Ok(ServerReadyData {
                url,
                username: None,
                password: None,
                is_sidecar: false,
            });
        }
    }

    // Spawn sidecar
    let port = find_available_port().map_err(|e| format!("No available port: {e}"))?;
    let password = uuid::Uuid::new_v4().to_string();
    let url = format!("http://127.0.0.1:{port}");

    let child = cli::spawn_server(app, port, &password)
        .await
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    app.try_state::<ServerState>()
        .expect("ServerState not found")
        .child
        .lock()
        .unwrap()
        .replace(child);

    // Wait for health check
    let timeout_duration = std::time::Duration::from_secs(30);
    match timeout(timeout_duration, server::wait_for_health(&url, "admin", &password)).await {
        Ok(Ok(())) => Ok(ServerReadyData {
            url,
            username: Some("admin".to_string()),
            password: Some(password),
            is_sidecar: true,
        }),
        Ok(Err(e)) => Err(format!("Health check failed: {e}")),
        Err(_) => Err("Server startup timed out".to_string()),
    }
}

fn find_available_port() -> Result<u16, std::io::Error> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}
