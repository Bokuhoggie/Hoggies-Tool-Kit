use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::media_commands::ffmpeg_path;

// yt-dlp ships a per-platform single-file build. macOS gets the universal binary; on
// Windows it's a plain .exe. Both are pulled from the "latest" release, so no checksum
// is pinned here — see the note in ensure_yt_dlp.
#[cfg(target_os = "macos")]
const YT_DLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
#[cfg(target_os = "windows")]
const YT_DLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

fn yt_dlp_path(app: &AppHandle) -> PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join(super::platform::exe_name("yt-dlp"))
}

async fn ensure_yt_dlp(app: &AppHandle) -> Result<PathBuf, String> {
    let path = yt_dlp_path(app);
    if path.exists() {
        return Ok(path);
    }

    let _ = app.emit("downloader:setup", serde_json::json!({ "stage": "downloading" }));

    // Download yt-dlp from GitHub releases. Write to a temp file first, then rename
    // atomically to prevent races when two concurrent calls both see exists() == false.
    //
    // NOTE: this tracks the "latest" release rather than a pinned tag, so there is no
    // checksum to verify against — unlike Real-ESRGAN, which is pinned. yt-dlp has to
    // stay current to keep working against sites that change constantly, and pinning it
    // would break the downloader within weeks.
    let tmp_path = path.with_extension("tmp");
    let url = YT_DLP_URL;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("Failed to download yt-dlp: {}", e))?;

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&tmp_path, &bytes).map_err(|e| e.to_string())?;

    super::platform::make_executable(&tmp_path)?;

    // Atomic rename into place
    std::fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;

    let _ = app.emit("downloader:setup", serde_json::json!({ "stage": "ready" }));

    Ok(path)
}

#[derive(Deserialize)]
pub struct DownloadArgs {
    pub url: String,
    #[serde(rename = "outputDir")]
    pub output_dir: Option<String>,
    #[serde(rename = "formatType")]
    pub format_type: Option<String>,
    pub quality: Option<String>,
    #[serde(rename = "audioFormat")]
    pub audio_format: Option<String>,
    #[serde(rename = "embedThumbnail")]
    pub embed_thumbnail: Option<bool>,
    #[serde(rename = "embedSubs")]
    pub embed_subs: Option<bool>,
    #[serde(rename = "subsLang")]
    pub subs_lang: Option<String>,
    #[serde(rename = "rateLimit")]
    pub rate_limit: Option<String>,
    #[serde(rename = "outputName")]
    pub output_name: Option<String>,
    #[serde(rename = "cookiesFromBrowser")]
    pub cookies_from_browser: Option<String>,
}

#[tauri::command]
pub async fn downloader_download(app: AppHandle, args: DownloadArgs) -> serde_json::Value {
    let yt_dlp = match ensure_yt_dlp(&app).await {
        Ok(p) => p,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Failed to initialize yt-dlp: {}", e)
            })
        }
    };

    let ffmpeg = ffmpeg_path(&app);
    let out_folder = args
        .output_dir
        .unwrap_or_else(|| dirs::download_dir().unwrap_or_else(|| PathBuf::from(".")).to_string_lossy().to_string());

    let safe_name = args
        .output_name
        .as_ref()
        .map(|n| {
            let cleaned: String = n
                .trim()
                .chars()
                .map(|c| {
                    if "<>:\"/\\|?*".contains(c) || (c as u32) < 0x20 {
                        '_'
                    } else {
                        c
                    }
                })
                .collect();
            let cleaned = cleaned.trim_end_matches('.').to_string();
            if cleaned.is_empty() {
                "%(title)s".to_string()
            } else {
                cleaned
            }
        })
        .unwrap_or_else(|| "%(title)s".to_string());

    let mut cmd_args: Vec<String> = vec![
        args.url.clone(),
        "-o".into(),
        PathBuf::from(&out_folder)
            .join(format!("{}.%(ext)s", safe_name))
            .to_string_lossy()
            .to_string(),
        "--no-playlist".into(),
    ];

    if ffmpeg.exists() {
        cmd_args.extend(["--ffmpeg-location".into(), ffmpeg.to_string_lossy().to_string()]);
    }

    let format_type = args.format_type.as_deref().unwrap_or("video");
    let quality = args.quality.as_deref().unwrap_or("1080p");
    let max_h = match quality {
        "720p" => 720,
        "480p" => 480,
        "360p" => 360,
        _ => 1080,
    };
    let is_twitter = args.url.contains("twitter.com")
        || args.url.contains("x.com")
        || args.url.contains("t.co");

    if format_type == "audio" {
        let audio_fmt = args.audio_format.as_deref().unwrap_or("mp3");
        cmd_args.extend(["-x".into(), "--audio-format".into(), audio_fmt.into()]);
    } else if is_twitter {
        // Twitter/X serves pre-muxed mp4 variants — pick the one that fits the quality cap.
        cmd_args.extend([
            "-f".into(),
            format!("best[height<={}][ext=mp4]/best[ext=mp4]/best", max_h),
            "--merge-output-format".into(),
            "mp4".into(),
        ]);
    } else {
        cmd_args.extend([
            "-f".into(),
            format!(
                "bestvideo[height<={}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={}]+bestaudio/best[height<={}]",
                max_h, max_h, max_h
            ),
            "--merge-output-format".into(),
            "mp4".into(),
        ]);
    }

    if args.embed_thumbnail.unwrap_or(false) {
        cmd_args.push("--embed-thumbnail".into());
    }
    if args.embed_subs.unwrap_or(false) {
        let lang = args.subs_lang.as_deref().unwrap_or("en");
        cmd_args.extend(["--embed-subs".into(), "--sub-lang".into(), lang.into()]);
    }
    if let Some(ref rl) = args.rate_limit {
        let trimmed = rl.trim();
        if !trimmed.is_empty() {
            cmd_args.extend(["--limit-rate".into(), trimmed.into()]);
        }
    }
    if let Some(ref browser) = args.cookies_from_browser {
        cmd_args.extend(["--cookies-from-browser".into(), browser.clone()]);
    }

    let mut child = match Command::new(&yt_dlp)
        .args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return serde_json::json!({ "success": false, "error": e.to_string() })
        }
    };

    // Parse progress from stdout
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut last_title = String::new();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.contains("[download]") {
                    // Parse percent
                    if let Some(cap) = line.find('%') {
                        let start = line[..cap]
                            .rfind(|c: char| c.is_whitespace())
                            .map(|i| i + 1)
                            .unwrap_or(0);
                        if let Ok(pct) = line[start..cap].parse::<f64>() {
                            let _ = app_clone.emit(
                                "downloader:progress",
                                serde_json::json!({ "percent": pct, "title": last_title }),
                            );
                        }
                    }
                    // Parse title from "Destination: ..."
                    if let Some(idx) = line.find("Destination:") {
                        let dest = line[idx + 12..].trim();
                        if let Some(name) = Path::new(dest).file_name() {
                            last_title = name.to_string_lossy().to_string();
                        }
                    }
                }
            }
        });
    }

    // Capture stderr so we can surface yt-dlp's actual error message instead of
    // a generic "exited with error". We collect into a buffer rather than
    // streaming because errors are usually a few lines and arrive at the end.
    let stderr_buf: std::sync::Arc<std::sync::Mutex<String>> =
        std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(mut s) = buf.lock() {
                    s.push_str(&line);
                    s.push('\n');
                }
            }
        });
    }

    match child.wait().await {
        Ok(status) if status.success() => {
            serde_json::json!({ "success": true, "outputDir": out_folder })
        }
        Ok(status) => {
            let err_text = stderr_buf.lock().map(|s| s.clone()).unwrap_or_default();
            // Pull the most useful line (yt-dlp puts the human message after "ERROR:")
            let msg = err_text
                .lines()
                .rev()
                .find(|l| l.contains("ERROR:"))
                .map(|l| l.trim().to_string())
                .unwrap_or_else(|| {
                    let trimmed = err_text.trim();
                    if trimmed.is_empty() {
                        format!("yt-dlp exited with code {}", status.code().unwrap_or(-1))
                    } else {
                        trimmed.to_string()
                    }
                });
            serde_json::json!({ "success": false, "error": msg })
        }
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

// ── yt-dlp version + self-update ──────────────────────────────────────────

#[tauri::command]
pub async fn downloader_yt_dlp_version(app: AppHandle) -> serde_json::Value {
    let yt_dlp = match ensure_yt_dlp(&app).await {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "installed": false, "error": e }),
    };
    let output = Command::new(&yt_dlp)
        .arg("--version")
        .output()
        .await;
    match output {
        Ok(o) if o.status.success() => {
            let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
            serde_json::json!({ "installed": true, "version": version })
        }
        Ok(o) => serde_json::json!({
            "installed": true,
            "error": String::from_utf8_lossy(&o.stderr).to_string()
        }),
        Err(e) => serde_json::json!({ "installed": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub async fn downloader_yt_dlp_update(app: AppHandle) -> serde_json::Value {
    // Force a fresh download by removing the current binary, then re-fetching.
    // yt-dlp's built-in `-U` is unreliable when the binary lives in app_data and
    // ownership/permissions can vary; a clean re-download is simpler and atomic.
    let path = yt_dlp_path(&app);
    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            return serde_json::json!({
                "success": false,
                "error": format!("Could not remove old binary: {}", e)
            });
        }
    }
    match ensure_yt_dlp(&app).await {
        Ok(_) => {
            // Report new version
            let v = downloader_yt_dlp_version(app).await;
            serde_json::json!({ "success": true, "version": v.get("version").cloned() })
        }
        Err(e) => serde_json::json!({ "success": false, "error": e }),
    }
}
