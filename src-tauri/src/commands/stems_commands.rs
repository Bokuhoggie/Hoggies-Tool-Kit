use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const RELEASE_URL: &str =
    "https://github.com/nikhilunni/demucs-rs/releases/latest/download/demucs-aarch64-apple-darwin.tar.gz";
const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/nikhilunni/demucs-rs/releases/latest";

fn demucs_dir(app: &AppHandle) -> PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = data_dir.join("demucs-rs");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn demucs_path(app: &AppHandle) -> PathBuf {
    demucs_dir(app).join("demucs")
}

fn version_path(app: &AppHandle) -> PathBuf {
    demucs_dir(app).join("version.txt")
}

async fn fetch_latest_tag() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("hoggies-tool-kit")
        .build()
        .ok()?;
    let body = client
        .get(LATEST_RELEASE_API)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    let json: serde_json::Value = serde_json::from_str(&body).ok()?;
    json.get("tag_name")?.as_str().map(|s| s.to_string())
}

async fn ensure_demucs(app: &AppHandle) -> Result<PathBuf, String> {
    let bin = demucs_path(app);
    if bin.exists() {
        return Ok(bin);
    }

    let _ = app.emit("stems:setup", serde_json::json!({ "stage": "downloading" }));

    let dir = demucs_dir(app);
    let tar_path = dir.join("demucs.tar.gz");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let bytes = client
        .get(RELEASE_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("Failed to download demucs: {}", e))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    std::fs::write(&tar_path, &bytes).map_err(|e| e.to_string())?;

    let _ = app.emit("stems:setup", serde_json::json!({ "stage": "extracting" }));

    // Extract — the tarball contains a single binary named "demucs"
    let f = std::fs::File::open(&tar_path).map_err(|e| e.to_string())?;
    let gz = flate2::read::GzDecoder::new(f);
    let mut archive = tar::Archive::new(gz);
    archive.unpack(&dir).map_err(|e| format!("extract failed: {}", e))?;

    // Locate the binary — flatten in case it's nested in a folder
    let bin_target = bin.clone();
    if !bin_target.exists() {
        if let Some(found) = find_binary(&dir, "demucs") {
            std::fs::rename(&found, &bin_target).map_err(|e| e.to_string())?;
        } else {
            return Err("demucs binary not found in archive".into());
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bin_target, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }

    let _ = std::fs::remove_file(&tar_path);

    // Record the release tag we just installed — demucs-rs's CLI doesn't expose
    // --version (clap treats it as the input file), so we track it ourselves.
    if let Some(tag) = fetch_latest_tag().await {
        let _ = std::fs::write(version_path(app), tag);
    }

    let _ = app.emit("stems:setup", serde_json::json!({ "stage": "ready" }));

    Ok(bin_target)
}

fn find_binary(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.file_name().map(|n| n == name).unwrap_or(false) {
            return Some(p);
        }
        if p.is_dir() {
            if let Some(nested) = find_binary(&p, name) {
                return Some(nested);
            }
        }
    }
    None
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || (c as u32) < 0x20 {
                '_'
            } else {
                c
            }
        })
        .collect()
}

#[derive(Deserialize)]
pub struct SeparateArgs {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
    pub model: Option<String>,           // htdemucs | htdemucs_6s | htdemucs_ft
    pub stems: Option<Vec<String>>,      // optional subset
    #[serde(rename = "outputName")]
    pub output_name: Option<String>,
}

#[tauri::command]
pub async fn stems_separate(app: AppHandle, args: SeparateArgs) -> serde_json::Value {
    let bin = match ensure_demucs(&app).await {
        Ok(p) => p,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Could not initialize demucs: {}", e)
            })
        }
    };

    let model = args.model.as_deref().unwrap_or("htdemucs");

    // demucs-rs writes to <output>/<track>/{vocals,drums,bass,other}.wav by default.
    // We give it a per-track subfolder named after the input stem so multiple runs don't collide.
    let track_stem = Path::new(&args.file_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "track".to_string());
    let safe_name = args
        .output_name
        .as_ref()
        .map(|n| sanitize(n.trim()))
        .filter(|s| !s.is_empty())
        .unwrap_or(track_stem);

    let track_out = PathBuf::from(&args.output_dir).join(&safe_name);
    if let Err(e) = std::fs::create_dir_all(&track_out) {
        return serde_json::json!({ "success": false, "error": format!("could not create output dir: {}", e) });
    }

    let mut cmd_args: Vec<String> = vec![
        "-m".into(), model.into(),
        "-o".into(), track_out.to_string_lossy().to_string(),
    ];
    if let Some(stems) = args.stems.as_ref() {
        if !stems.is_empty() {
            cmd_args.extend(["-s".into(), stems.join(",")]);
        }
    }
    cmd_args.push(args.file_path.clone());

    let mut child = match Command::new(&bin)
        .args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };

    // Stream stdout: emit any "%" lines we see for progress UI.
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(pct) = parse_percent(&line) {
                    let _ = app_clone.emit(
                        "stems:progress",
                        serde_json::json!({ "percent": pct, "stage": detect_stage(&line) }),
                    );
                }
            }
        });
    }

    // Capture stderr for error reporting; demucs-rs uses stderr for tqdm-style progress too,
    // so we also try to extract a percent there.
    let stderr_buf: std::sync::Arc<std::sync::Mutex<String>> =
        std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let buf = stderr_buf.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(pct) = parse_percent(&line) {
                    let _ = app_clone.emit(
                        "stems:progress",
                        serde_json::json!({ "percent": pct, "stage": detect_stage(&line) }),
                    );
                }
                if let Ok(mut s) = buf.lock() {
                    s.push_str(&line);
                    s.push('\n');
                }
            }
        });
    }

    match child.wait().await {
        Ok(status) if status.success() => {
            serde_json::json!({ "success": true, "outputDir": track_out.to_string_lossy().to_string() })
        }
        Ok(status) => {
            let err_text = stderr_buf.lock().map(|s| s.clone()).unwrap_or_default();
            let msg = err_text
                .lines()
                .rev()
                .find(|l| l.to_lowercase().contains("error"))
                .map(|l| l.trim().to_string())
                .unwrap_or_else(|| {
                    let trimmed = err_text.trim();
                    if trimmed.is_empty() {
                        format!("demucs exited with code {}", status.code().unwrap_or(-1))
                    } else {
                        trimmed.to_string()
                    }
                });
            serde_json::json!({ "success": false, "error": msg })
        }
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

fn parse_percent(line: &str) -> Option<f64> {
    let pct_idx = line.find('%')?;
    let start = line[..pct_idx]
        .rfind(|c: char| c.is_whitespace() || c == '|' || c == '[')
        .map(|i| i + 1)
        .unwrap_or(0);
    line[start..pct_idx].trim().parse::<f64>().ok()
}

fn detect_stage(line: &str) -> &'static str {
    let l = line.to_lowercase();
    if l.contains("download") || l.contains("fetch") {
        "downloading-model"
    } else if l.contains("load") {
        "loading"
    } else {
        "separating"
    }
}

#[tauri::command]
pub async fn stems_demucs_version(app: AppHandle) -> serde_json::Value {
    // Don't trigger a download just to read a version — only report if installed.
    let bin = demucs_path(&app);
    if !bin.exists() {
        return serde_json::json!({ "installed": false });
    }
    if let Some(v) = std::fs::read_to_string(version_path(&app))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        return serde_json::json!({ "installed": true, "version": v });
    }
    // Legacy install (downloaded before version tracking) — best-effort fetch the tag
    // and persist it. The binary is whatever was "latest" at install time, which we
    // can't recover precisely, but the latest tag is a reasonable surrogate label.
    if let Some(tag) = fetch_latest_tag().await {
        let _ = std::fs::write(version_path(&app), &tag);
        return serde_json::json!({ "installed": true, "version": tag });
    }
    serde_json::json!({ "installed": true, "version": "installed" })
}

#[tauri::command]
pub async fn stems_demucs_update(app: AppHandle) -> serde_json::Value {
    let bin = demucs_path(&app);
    if bin.exists() {
        if let Err(e) = std::fs::remove_file(&bin) {
            return serde_json::json!({
                "success": false,
                "error": format!("Could not remove old binary: {}", e)
            });
        }
    }
    let _ = std::fs::remove_file(version_path(&app));
    match ensure_demucs(&app).await {
        Ok(_) => {
            let v = stems_demucs_version(app).await;
            serde_json::json!({ "success": true, "version": v.get("version").cloned() })
        }
        Err(e) => serde_json::json!({ "success": false, "error": e }),
    }
}
