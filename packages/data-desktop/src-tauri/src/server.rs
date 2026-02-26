use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio::time::{sleep, Duration};

const STORE_PATH: &str = "data-desktop-settings.json";
const SERVER_URL_KEY: &str = "defaultServerUrl";

pub async fn get_saved_server_url(app: &AppHandle) -> Option<String> {
    let store = app.store(STORE_PATH).ok()?;
    store
        .get(SERVER_URL_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
}

pub async fn check_health(url: &str, username: Option<&str>, password: Option<&str>) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut req = client.post(format!("{url}/global/health"));

    if let (Some(user), Some(pass)) = (username, password) {
        req = req.basic_auth(user, Some(pass));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Health check request failed: {e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("Health check returned status {}", resp.status()))
    }
}

pub async fn wait_for_health(url: &str, username: &str, password: &str) -> Result<(), String> {
    let mut attempts = 0;
    let max_attempts = 60;

    loop {
        if check_health(url, Some(username), Some(password))
            .await
            .is_ok()
        {
            return Ok(());
        }

        attempts += 1;
        if attempts >= max_attempts {
            return Err("Server did not become healthy in time".to_string());
        }

        sleep(Duration::from_millis(500)).await;
    }
}
