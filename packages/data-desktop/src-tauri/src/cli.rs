use std::process::Stdio;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

pub struct CommandChild {
    child: tokio::process::Child,
}

impl CommandChild {
    pub fn kill(mut self) -> Result<(), String> {
        self.child
            .start_kill()
            .map_err(|e| format!("Failed to kill process: {e}"))
    }
}

pub async fn spawn_server(app: &AppHandle, port: u16, password: &str) -> Result<CommandChild, String> {
    let sidecar_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?
        .join("sidecars")
        .join(sidecar_binary_name());

    if !sidecar_path.exists() {
        return Err(format!(
            "Sidecar binary not found at: {}",
            sidecar_path.display()
        ));
    }

    let child = Command::new(&sidecar_path)
        .args(["serve", "--port", &port.to_string()])
        .env("OPENCODE_SERVER_PASSWORD", password)
        .env("OPENCODE_SERVER_HOST", "127.0.0.1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    tracing::info!(
        path = %sidecar_path.display(),
        port = port,
        "Spawned sidecar"
    );

    Ok(CommandChild { child })
}

fn sidecar_binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "opencode-cli.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "opencode-cli"
    }
}
