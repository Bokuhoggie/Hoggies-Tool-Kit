use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, BufReader};
use tokio::process::Command;

// Real-ESRGAN ncnn-vulkan — precompiled, GPU-accelerated super-resolution.
// The macOS asset is a .zip containing the binary plus a `models/` folder.
const RELEASE_TAG: &str = "v0.2.5.0";
const RELEASE_DATE: &str = "20220424";

#[cfg(target_os = "macos")]
const RELEASE_URL: &str = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip";
#[cfg(target_os = "macos")]
const RELEASE_SHA256: &str = "e0ad05580abfeb25f8d8fb55aaf7bedf552c375b5b4d9bd3c8d59764d2cc333a";

#[cfg(target_os = "windows")]
const RELEASE_URL: &str = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip";
#[cfg(target_os = "windows")]
const RELEASE_SHA256: &str = "abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d";

#[cfg(target_os = "windows")]
const BIN_NAME: &str = "realesrgan-ncnn-vulkan.exe";
#[cfg(not(target_os = "windows"))]
const BIN_NAME: &str = "realesrgan-ncnn-vulkan";

fn upscale_dir(app: &AppHandle) -> PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = data_dir.join("realesrgan");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn bin_path(app: &AppHandle) -> PathBuf {
    upscale_dir(app).join(BIN_NAME)
}

fn models_dir(app: &AppHandle) -> PathBuf {
    upscale_dir(app).join("models")
}

fn version_path(app: &AppHandle) -> PathBuf {
    upscale_dir(app).join("version.txt")
}

/// Compare a downloaded payload against a pinned SHA-256, as lowercase hex.
fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};

    if expected.is_empty() {
        return Err("no pinned checksum for this platform — refusing to install".into());
    }

    let actual = hex::encode(Sha256::digest(bytes));
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "checksum mismatch (expected {}, got {}) — refusing to install",
            expected, actual
        ))
    }
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

/// Recursively locate a file by name under `dir` (zips sometimes nest in a folder).
fn find_entry(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.file_name().map(|n| n == name).unwrap_or(false) {
            return Some(p);
        }
        if p.is_dir() {
            if let Some(found) = find_entry(&p, name) {
                return Some(found);
            }
        }
    }
    None
}

async fn ensure_realesrgan(app: &AppHandle) -> Result<PathBuf, String> {
    let bin = bin_path(app);
    if bin.exists() && models_dir(app).exists() {
        return Ok(bin);
    }

    // Install can fail or be interrupted mid-extract. If anything goes wrong, roll
    // back every partial artifact so a half-written binary or incomplete models dir
    // can never pass the `exists()` guard above on the next attempt.
    match install_realesrgan(app).await {
        Ok(p) => Ok(p),
        Err(e) => {
            let dir = upscale_dir(app);
            let _ = std::fs::remove_file(bin_path(app));
            let _ = std::fs::remove_dir_all(models_dir(app));
            let _ = std::fs::remove_dir_all(dir.join(".staging"));
            let _ = std::fs::remove_file(version_path(app));
            Err(e)
        }
    }
}

async fn install_realesrgan(app: &AppHandle) -> Result<PathBuf, String> {
    let _ = app.emit("upscale:setup", serde_json::json!({ "stage": "downloading" }));

    // Download + extract into a staging dir, then atomically move the binary and
    // models into their final paths. Both live on the same filesystem, so the
    // renames are cheap and atomic — the final paths only ever appear complete.
    let dir = upscale_dir(app);
    let staging = dir.join(".staging");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let zip_path = staging.join("realesrgan.zip");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent("hoggies-tool-kit")
        .build()
        .map_err(|e| e.to_string())?;

    let bytes = client
        .get(RELEASE_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("Failed to download Real-ESRGAN: {}", e))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    // Verify the download against a pinned hash before anything is extracted or executed.
    // We fetch a binary over the network and then run it, so this is the only thing
    // standing between a swapped/tampered asset and arbitrary code execution.
    verify_sha256(&bytes, RELEASE_SHA256)?;

    std::fs::write(&zip_path, &bytes).map_err(|e| e.to_string())?;

    let _ = app.emit("upscale:setup", serde_json::json!({ "stage": "extracting" }));

    {
        let f = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(f).map_err(|e| format!("bad zip: {}", e))?;
        archive
            .extract(&staging)
            .map_err(|e| format!("extract failed: {}", e))?;
    }

    // Locate the binary + models inside staging (flatten in case the zip nests them).
    let found_bin =
        find_entry(&staging, BIN_NAME).ok_or("Real-ESRGAN binary not found in archive")?;
    let found_models = find_entry(&staging, "models")
        .filter(|p| p.is_dir())
        .ok_or("Real-ESRGAN models not found in archive")?;

    let bin = bin_path(app);
    let md = models_dir(app);
    let _ = std::fs::remove_file(&bin);
    let _ = std::fs::remove_dir_all(&md);
    std::fs::rename(&found_bin, &bin).map_err(|e| e.to_string())?;
    std::fs::rename(&found_models, &md).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }

    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::write(version_path(app), format!("{} ({})", RELEASE_TAG, RELEASE_DATE));

    let _ = app.emit("upscale:setup", serde_json::json!({ "stage": "ready" }));

    Ok(bin)
}

#[derive(Deserialize)]
pub struct UpscaleArgs {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
    pub scale: Option<u32>,        // 2 | 3 | 4
    pub model: Option<String>,     // realesrgan-x4plus | realesrgan-x4plus-anime | realesr-animevideov3
    #[serde(rename = "outputName")]
    pub output_name: Option<String>,
}

#[tauri::command]
pub async fn image_upscale(app: AppHandle, args: UpscaleArgs) -> serde_json::Value {
    let bin = match ensure_realesrgan(&app).await {
        Ok(p) => p,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Could not initialize Real-ESRGAN: {}", e)
            })
        }
    };

    let scale = args.scale.unwrap_or(4).clamp(2, 4);
    let mut model = args
        .model
        .as_deref()
        .unwrap_or("realesrgan-x4plus")
        .to_string();

    // The anime-video model ships per-scale variants (…-x2/-x3/-x4); the
    // photo/anime models are single x4 files that the binary rescales as needed.
    if model == "realesr-animevideov3" {
        model = format!("realesr-animevideov3-x{}", scale);
    }

    let stem = Path::new(&args.file_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".to_string());
    let safe_name = args
        .output_name
        .as_ref()
        .map(|n| sanitize(n.trim()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{}_x{}", stem, scale));

    if let Err(e) = std::fs::create_dir_all(&args.output_dir) {
        return serde_json::json!({ "success": false, "error": format!("could not create output dir: {}", e) });
    }
    let out_path = PathBuf::from(&args.output_dir).join(format!("{}.png", safe_name));

    let _ = app.emit("upscale:progress", serde_json::json!({ "stage": "upscaling" }));

    let mut child = match Command::new(&bin)
        .args([
            "-i".into(),
            args.file_path.clone(),
            "-o".into(),
            out_path.to_string_lossy().to_string(),
            "-s".into(),
            scale.to_string(),
            "-n".into(),
            model.clone(),
            "-m".into(),
            models_dir(&app).to_string_lossy().to_string(),
            "-f".into(),
            "png".into(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };

    // realesrgan-ncnn-vulkan emits tile progress to stderr as bare percentages
    // (e.g. "12.50%"). Read raw bytes since it uses carriage returns, not newlines.
    let stderr_buf: std::sync::Arc<std::sync::Mutex<String>> =
        std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let buf = stderr_buf.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut chunk = [0u8; 256];
            loop {
                match reader.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&chunk[..n]);
                        for token in text.split(['\r', '\n']) {
                            let t = token.trim();
                            if let Some(pct) = t.strip_suffix('%').and_then(|p| p.trim().parse::<f64>().ok()) {
                                let _ = app_clone.emit(
                                    "upscale:progress",
                                    serde_json::json!({ "stage": "upscaling", "percent": pct }),
                                );
                            }
                        }
                        if let Ok(mut s) = buf.lock() {
                            s.push_str(&text);
                        }
                    }
                }
            }
        });
    }

    match child.wait().await {
        Ok(status) if status.success() => {
            serde_json::json!({ "success": true, "outputPath": out_path.to_string_lossy().to_string() })
        }
        Ok(status) => {
            let err_text = stderr_buf.lock().map(|s| s.clone()).unwrap_or_default();
            let msg = err_text
                .lines()
                .rev()
                .find(|l| {
                    let l = l.to_lowercase();
                    l.contains("error") || l.contains("failed") || l.contains("vulkan")
                })
                .map(|l| l.trim().to_string())
                .unwrap_or_else(|| {
                    let trimmed = err_text.trim();
                    if trimmed.is_empty() {
                        format!("Real-ESRGAN exited with code {}", status.code().unwrap_or(-1))
                    } else {
                        trimmed.to_string()
                    }
                });
            serde_json::json!({ "success": false, "error": msg })
        }
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub async fn image_realesrgan_version(app: AppHandle) -> serde_json::Value {
    // Don't trigger a download just to read the version — only report if installed.
    if !bin_path(&app).exists() {
        return serde_json::json!({ "installed": false });
    }
    let version = std::fs::read_to_string(version_path(&app))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| RELEASE_TAG.to_string());
    serde_json::json!({ "installed": true, "version": version })
}

#[cfg(test)]
mod tests {
    use super::*;

    // SHA-256 of "abc", a standard test vector.
    const ABC_SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn accepts_matching_checksum() {
        assert!(verify_sha256(b"abc", ABC_SHA).is_ok());
    }

    #[test]
    fn accepts_uppercase_checksum() {
        assert!(verify_sha256(b"abc", &ABC_SHA.to_uppercase()).is_ok());
    }

    #[test]
    fn rejects_tampered_payload() {
        assert!(verify_sha256(b"abd", ABC_SHA).is_err());
    }

    #[test]
    fn rejects_empty_pin_rather_than_skipping() {
        // An unset checksum must fail closed — never silently install unverified bytes.
        assert!(verify_sha256(b"abc", "").is_err());
    }

    #[test]
    fn sanitize_strips_path_separators() {
        assert_eq!(sanitize("../../etc/passwd"), ".._.._etc_passwd");
        assert_eq!(sanitize("a:b*c?"), "a_b_c_");
        assert_eq!(sanitize("normal-name"), "normal-name");
    }
}

#[tauri::command]
pub async fn image_realesrgan_update(app: AppHandle) -> serde_json::Value {
    // Pinned to a known-good release; "update" simply re-fetches a clean copy.
    let _ = std::fs::remove_file(bin_path(&app));
    let _ = std::fs::remove_dir_all(models_dir(&app));
    let _ = std::fs::remove_file(version_path(&app));

    match ensure_realesrgan(&app).await {
        Ok(_) => {
            let v = image_realesrgan_version(app).await;
            serde_json::json!({ "success": true, "version": v.get("version").cloned() })
        }
        Err(e) => serde_json::json!({ "success": false, "error": e }),
    }
}
