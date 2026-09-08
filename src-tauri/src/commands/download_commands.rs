use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::media_commands::ffmpeg_path;

// yt-dlp ships a per-platform single-file build. macOS gets the universal binary; on
// Windows it's a plain .exe. Both are pulled from the "latest" release, so no checksum
// is pinned here — see the note in fetch_yt_dlp.
#[cfg(target_os = "macos")]
const YT_DLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
#[cfg(target_os = "windows")]
const YT_DLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

/// Release metadata, used to see whether a newer build exists *before* spending 30 MB
/// on a re-download.
const YT_DLP_LATEST_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

/// GitHub's API rejects requests that arrive without a User-Agent.
const USER_AGENT: &str = "hoggies-tool-kit";

/// JavaScript runtimes yt-dlp can drive, in its own order of preference. Only `deno` is
/// enabled by default, and HTK bundles none of them — see the note where these are
/// passed.
const JS_RUNTIMES: [&str; 4] = ["deno", "node", "quickjs", "bun"];

/// How often to look for a newer yt-dlp.
///
/// yt-dlp goes stale fast. YouTube rotates its player and signature scheme every few
/// weeks, and a binary that worked last month starts failing mid-transfer with
/// `unable to download video data: HTTP Error 403: Forbidden` — the media URL is
/// accepted for a short range probe and then refused for the real read. A stale binary
/// is by far the most common cause of "the downloader stopped working", so check daily.
/// The check itself is one small API call; the 30 MB only moves when the version differs.
const UPDATE_CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;

fn yt_dlp_path(app: &AppHandle) -> PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join(super::platform::exe_name("yt-dlp"))
}

/// Timestamp of the last update check, kept beside the binary.
fn update_stamp_path(binary: &Path) -> PathBuf {
    binary.with_extension("update-check")
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn touch_update_stamp(binary: &Path) {
    let _ = std::fs::write(update_stamp_path(binary), now_secs().to_string());
}

/// True when the daily check is due, including the case where no stamp exists yet — a
/// binary installed by an older build that never wrote one is exactly the stale case.
fn update_check_due(binary: &Path) -> bool {
    std::fs::read_to_string(update_stamp_path(binary))
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(|t| now_secs().saturating_sub(t) > UPDATE_CHECK_INTERVAL_SECS)
        .unwrap_or(true)
}

/// Version string reported by a yt-dlp binary, e.g. "2026.08.19".
async fn installed_version(binary: &Path) -> Option<String> {
    let out = Command::new(binary).arg("--version").output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// Tag of the newest published release. `None` on any failure — offline, rate-limited,
/// or a changed payload all mean "leave the working binary alone".
async fn latest_version() -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;
    let bytes = client
        .get(YT_DLP_LATEST_API)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .bytes()
        .await
        .ok()?;
    let body: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    body.get("tag_name")?.as_str().map(|s| s.trim().to_string())
}

async fn fetch_into_staging(staging: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(YT_DLP_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("Failed to download yt-dlp: {}", e))?;

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(staging, &bytes).map_err(|e| e.to_string())?;
    super::platform::make_executable(staging)?;

    // Smoke test before it is allowed to become the real binary.
    if installed_version(staging).await.is_none() {
        return Err("the downloaded yt-dlp build did not run".into());
    }
    Ok(())
}

/// Download the current yt-dlp release into `path`.
///
/// Follows the external-engine pattern from CLAUDE.md: stage beside the target, smoke
/// test it, move it into place in one step, and delete every partial artifact on failure
/// so a half-written binary can never satisfy the "already installed" check.
///
/// NOTE: this tracks the "latest" release rather than a pinned tag, so there is no
/// checksum to verify against — unlike Real-ESRGAN, which is pinned. yt-dlp has to stay
/// current to keep working against sites that change constantly, and pinning it would
/// break the downloader within weeks. Running `--version` successfully is the substitute
/// integrity check.
async fn fetch_yt_dlp(app: &AppHandle, path: &Path, stage: &str) -> Result<(), String> {
    let _ = app.emit("downloader:setup", serde_json::json!({ "stage": stage }));

    let staging = path.with_file_name(super::platform::exe_name("yt-dlp-staging"));
    let _ = std::fs::remove_file(&staging);

    if let Err(e) = fetch_into_staging(&staging).await {
        let _ = std::fs::remove_file(&staging);
        return Err(e);
    }

    // Replace in one step. rename() overwrites the destination on both platforms, so
    // there is never a window where the binary is missing.
    if let Err(e) = std::fs::rename(&staging, path) {
        let _ = std::fs::remove_file(&staging);
        return Err(e.to_string());
    }

    touch_update_stamp(path);
    let _ = app.emit("downloader:setup", serde_json::json!({ "stage": "ready" }));
    Ok(())
}

/// Replace the binary only if the release feed offers a different version.
///
/// Returns the new version when the swap actually happened. Re-downloading the build
/// that is already installed cannot fix anything and costs the user 30 MB, so a matching
/// version just refreshes the stamp.
async fn update_if_newer(app: &AppHandle, path: &Path) -> Option<String> {
    // Stamp first: a check that fails — offline, rate-limited — must not re-run on
    // every single download.
    touch_update_stamp(path);

    let latest = latest_version().await?;
    let current = installed_version(path).await?;
    // Both come from the same stable release feed, so they are directly comparable and
    // any difference means the installed one is behind.
    if latest == current {
        return None;
    }
    fetch_yt_dlp(app, path, "updating").await.ok()?;
    Some(latest)
}

async fn ensure_yt_dlp(app: &AppHandle) -> Result<PathBuf, String> {
    let path = yt_dlp_path(app);
    if path.exists() {
        if update_check_due(&path) {
            update_if_newer(app, &path).await;
        }
        return Ok(path);
    }

    fetch_yt_dlp(app, &path, "downloading").await?;
    Ok(path)
}

/// yt-dlp failures that mean "this build no longer understands the site", as opposed to
/// a problem with the URL the user typed.
///
/// Kept deliberately narrow: a match triggers a version check and possibly a 30 MB
/// download, so a private video, a deleted post or a typo must not land here.
fn looks_like_stale_extractor(stderr: &str) -> bool {
    const SIGNATURES: [&str; 6] = [
        // The signature/throttling parameter this build produces is no longer accepted,
        // so the media URL is refused once the real transfer starts.
        "http error 403",
        "unable to download video data",
        "nsig extraction failed",
        // The player response changed shape underneath the extractor.
        "failed to extract any player response",
        "only images are available",
        "the page needs to be reloaded",
    ];
    let haystack = stderr.to_ascii_lowercase();
    SIGNATURES.iter().any(|s| haystack.contains(s))
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

/// A failed yt-dlp run, with enough context to both explain it and decide whether it is
/// worth retrying.
struct RunFailure {
    stderr: String,
    code: Option<i32>,
}

impl RunFailure {
    /// The most useful line for the user. yt-dlp puts the human message after "ERROR:".
    fn message(&self) -> String {
        self.stderr
            .lines()
            .rev()
            .find(|l| l.contains("ERROR:"))
            .map(|l| l.trim().to_string())
            .unwrap_or_else(|| {
                let trimmed = self.stderr.trim();
                if trimmed.is_empty() {
                    format!("yt-dlp exited with code {}", self.code.unwrap_or(-1))
                } else {
                    trimmed.to_string()
                }
            })
    }
}

/// Run yt-dlp once, streaming download progress to the UI as it goes.
async fn run_yt_dlp(app: &AppHandle, yt_dlp: &Path, cmd_args: &[String]) -> Result<(), RunFailure> {
    let mut child = match Command::new(yt_dlp)
        .args(cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return Err(RunFailure {
                stderr: e.to_string(),
                code: None,
            })
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
    let stderr_task = child.stderr.take().map(|stderr| {
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
        })
    });

    let status = match child.wait().await {
        Ok(s) => s,
        Err(e) => {
            return Err(RunFailure {
                stderr: e.to_string(),
                code: None,
            })
        }
    };

    // wait() returns as soon as the process exits, which can be before the reader has
    // drained the pipe. Join it, or both the message and the retry decision below are
    // made against a stderr buffer that is still filling up.
    if let Some(task) = stderr_task {
        let _ = task.await;
    }

    if status.success() {
        return Ok(());
    }
    Err(RunFailure {
        stderr: stderr_buf.lock().map(|s| s.clone()).unwrap_or_default(),
        code: status.code(),
    })
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
        // Progress is written with carriage returns by default, so the line reader above
        // sees one enormous line and the bar only moves in bursts.
        "--newline".into(),
    ];

    // YouTube extraction without a JavaScript runtime is deprecated, and yt-dlp warns
    // that formats may go missing. The JS itself ships inside the official yt-dlp build
    // (yt_dlp_ejs) — only the runtime to execute it is absent, and HTK bundles none.
    //
    // So enable all four and let yt-dlp choose: it uses the highest-priority one that is
    // actually installed, and naming a runtime that is missing is a no-op, not an error.
    // That means whichever of these the user happens to have gets picked up, with no
    // detection here to keep in sync with yt-dlp's own lookup.
    for runtime in JS_RUNTIMES {
        cmd_args.extend(["--js-runtimes".into(), runtime.to_string()]);
    }

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

    let failure = match run_yt_dlp(&app, &yt_dlp, &cmd_args).await {
        Ok(()) => return serde_json::json!({ "success": true, "outputDir": out_folder }),
        Err(f) => f,
    };

    // A 403 — or a player response the extractor cannot read — is almost always a stale
    // binary rather than a bad URL. The daily check can sit up to a day behind a breaking
    // change on YouTube's side, so treat the failure itself as the signal: pull a newer
    // build if one exists, and try again once.
    if looks_like_stale_extractor(&failure.stderr) {
        if let Some(version) = update_if_newer(&app, &yt_dlp).await {
            return match run_yt_dlp(&app, &yt_dlp, &cmd_args).await {
                Ok(()) => serde_json::json!({
                    "success": true,
                    "outputDir": out_folder,
                    "updatedYtDlp": version
                }),
                Err(f) => serde_json::json!({ "success": false, "error": f.message() }),
            };
        }
    }

    serde_json::json!({ "success": false, "error": failure.message() })
}

// ── yt-dlp version + self-update ──────────────────────────────────────────

#[tauri::command]
pub async fn downloader_yt_dlp_version(app: AppHandle) -> serde_json::Value {
    let yt_dlp = match ensure_yt_dlp(&app).await {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "installed": false, "error": e }),
    };
    match installed_version(&yt_dlp).await {
        Some(version) => serde_json::json!({ "installed": true, "version": version }),
        None => serde_json::json!({ "installed": true, "error": "yt-dlp --version failed" }),
    }
}

#[tauri::command]
pub async fn downloader_yt_dlp_update(app: AppHandle) -> serde_json::Value {
    // Unconditional re-download: this is the "a site broke, fix it now" button, so it
    // does not skip out when the version happens to match. yt-dlp's own `-U` is
    // unreliable when the binary lives in app_data and ownership/permissions can vary;
    // a staged re-download is simpler and atomic.
    let path = yt_dlp_path(&app);
    match fetch_yt_dlp(&app, &path, "updating").await {
        Ok(()) => serde_json::json!({
            "success": true,
            "version": installed_version(&path).await
        }),
        Err(e) => serde_json::json!({ "success": false, "error": e }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_signatures_match_real_yt_dlp_output() {
        // Verbatim from a 2026.07.04 binary against a YouTube URL that the 2026.08.19
        // build downloads without complaint.
        assert!(looks_like_stale_extractor(
            "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        ));
        assert!(looks_like_stale_extractor(
            "WARNING: Only images are available for download. use --list-formats to see them"
        ));
        assert!(looks_like_stale_extractor(
            "ERROR: [youtube] FjFPy3N2tV4: The page needs to be reloaded."
        ));
    }

    #[test]
    fn user_errors_do_not_trigger_a_retry() {
        // Re-downloading the engine cannot fix any of these, and each one costs 30 MB.
        assert!(!looks_like_stale_extractor(
            "ERROR: [youtube] abc: Private video. Sign in if you have been granted access"
        ));
        assert!(!looks_like_stale_extractor("ERROR: [youtube] abc: Video unavailable"));
        assert!(!looks_like_stale_extractor(
            "ERROR: unable to open for writing: [Errno 13] Permission denied"
        ));
        assert!(!looks_like_stale_extractor("ERROR: HTTP Error 404: Not Found"));
        assert!(!looks_like_stale_extractor(""));
    }

    #[test]
    fn failure_message_prefers_the_error_line() {
        let f = RunFailure {
            stderr: "[youtube] Extracting URL: https://example.com\n\
                     WARNING: something cosmetic\n\
                     ERROR: unable to download video data: HTTP Error 403: Forbidden\n"
                .into(),
            code: Some(1),
        };
        assert_eq!(
            f.message(),
            "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        );
    }

    #[test]
    fn failure_message_falls_back_to_the_exit_code() {
        let f = RunFailure {
            stderr: String::new(),
            code: Some(2),
        };
        assert_eq!(f.message(), "yt-dlp exited with code 2");
    }

    #[test]
    fn update_stamp_sits_beside_the_binary() {
        assert_eq!(
            update_stamp_path(Path::new("/data/yt-dlp.exe")).file_name().unwrap(),
            "yt-dlp.update-check"
        );
        assert_eq!(
            update_stamp_path(Path::new("/data/yt-dlp")).file_name().unwrap(),
            "yt-dlp.update-check"
        );
    }

    /// Exercises the real update path: download, smoke test, replace. Ignored by
    /// default because it pulls 30 MB from GitHub — CI must not depend on that.
    /// Run it after touching fetch_yt_dlp: `cargo test staged_update -- --ignored`.
    #[test]
    #[ignore = "hits the network; run with -- --ignored"]
    fn staged_update_replaces_a_stale_binary() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let dir = std::env::temp_dir().join("htk-ytdlp-staging-test");
            std::fs::create_dir_all(&dir).unwrap();
            let target = dir.join(super::super::platform::exe_name("yt-dlp"));
            std::fs::write(&target, b"stale placeholder").unwrap();
            let staging = target.with_file_name(super::super::platform::exe_name("yt-dlp-staging"));

            fetch_into_staging(&staging).await.expect("staged download + smoke test");
            std::fs::rename(&staging, &target).expect("atomic replace over existing file");
            assert!(!staging.exists(), "staging file must be consumed");

            let local = installed_version(&target).await.expect("replaced binary runs");
            let remote = latest_version().await.expect("release feed reachable");
            assert_eq!(local, remote, "fetch must land on the latest release");
            println!("OK: installed {}, latest {}", local, remote);

            std::fs::remove_dir_all(&dir).ok();
        });
    }

    #[test]
    fn a_missing_stamp_counts_as_due() {
        // Binaries installed before the update check existed have no stamp; they are
        // the most likely to be stale, so they must not be treated as fresh.
        assert!(update_check_due(Path::new("/nonexistent/yt-dlp.exe")));
    }
}
