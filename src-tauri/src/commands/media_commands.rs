use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Resolve a binary bundled under `resources/`.
///
/// In a packaged app it lives in the Tauri resource dir. In development that dir is the
/// build output folder, which the bundler hasn't populated, so we fall back to
/// `src-tauri/resources/` where `npm run ffmpeg:fetch` places the binaries.
fn bundled_binary(app: &AppHandle, name: &str) -> PathBuf {
    let file = super::platform::exe_name(name);

    let packaged = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("resources")
        .join(&file);

    if packaged.exists() {
        return packaged;
    }

    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(&file);
        if dev.exists() {
            return dev;
        }
    }

    packaged
}

pub fn ffmpeg_path(app: &AppHandle) -> PathBuf {
    bundled_binary(app, "ffmpeg")
}

pub fn ffprobe_path(app: &AppHandle) -> PathBuf {
    bundled_binary(app, "ffprobe")
}

// ── Video Convert ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct VideoConvertArgs {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "outputFormat")]
    pub output_format: String,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
    pub resolution: Option<String>,
    pub crf: Option<u32>,
    pub codec: Option<String>,
    #[serde(rename = "audioCodec")]
    pub audio_codec: Option<String>,
    #[serde(rename = "audioBitrate")]
    pub audio_bitrate: Option<String>,
    pub fps: Option<String>,
    #[serde(rename = "hwAccel")]
    pub hw_accel: Option<String>,
    #[serde(rename = "outputName")]
    pub output_name: Option<String>,
}

#[derive(Serialize)]
pub struct MediaResult {
    pub success: bool,
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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

/// Encoder to use when the video converter is asked for an audio-only container.
///
/// Picking one of these output formats means "throw the picture away and keep the
/// sound" — the usual reason being an MP4 you want as an MP3. Returns `None` for a
/// real video container.
///
/// The encoder is chosen from the container rather than from the Advanced tab's Audio
/// Codec setting: that setting exists to pick the audio track *inside* a video file,
/// and its default (`aac`) is not muxable into an `.mp3`. Honouring it here would turn
/// the common case into an ffmpeg error.
fn audio_only_encoder(format: &str) -> Option<&'static str> {
    match format.to_ascii_lowercase().as_str() {
        "mp3" => Some("libmp3lame"),
        "m4a" | "aac" => Some("aac"),
        "wav" => Some("pcm_s16le"),
        "flac" => Some("flac"),
        "ogg" | "opus" => Some("libopus"),
        _ => None,
    }
}

/// Lossless audio targets, where a bitrate is meaningless.
///
/// ffmpeg does not reject `-b:a` here — verified against the bundled 6.1.1 build, it
/// accepts the flag for pcm and flac and silently ignores it, byte-for-byte identical
/// output either way. So this guard is about not sending a setting that has no meaning
/// for the target, not about avoiding an error.
fn is_lossless_audio(format: &str) -> bool {
    matches!(format.to_ascii_lowercase().as_str(), "wav" | "flac")
}

#[tauri::command]
pub async fn video_convert(app: AppHandle, args: VideoConvertArgs) -> MediaResult {
    let ffmpeg = ffmpeg_path(&app);
    if !ffmpeg.exists() {
        return MediaResult {
            success: false,
            output_path: None,
            error: Some("ffmpeg binary not found in resources".into()),
        };
    }

    let auto_name = Path::new(&args.file_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let safe_name = args
        .output_name
        .as_ref()
        .map(|n| sanitize(n.trim()))
        .unwrap_or_default();
    let base_name = if safe_name.is_empty() {
        format!("{}_converted", auto_name)
    } else {
        safe_name
    };
    let out_path = PathBuf::from(&args.output_dir)
        .join(format!("{}.{}", base_name, args.output_format));

    // An audio-only target drops the video stream, and with it every video-side
    // setting — codec, resolution, CRF, frame rate and decode acceleration all either
    // do nothing or make ffmpeg fail once there is no picture to work on.
    let audio_encoder = audio_only_encoder(&args.output_format);
    let audio_only = audio_encoder.is_some();

    let mut cmd_args: Vec<String> = Vec::new();

    // Hardware acceleration
    if let Some(ref hw) = args.hw_accel {
        if !hw.is_empty() && !audio_only {
            cmd_args.extend(["-hwaccel".into(), hw.clone()]);
        }
    }

    cmd_args.extend(["-i".into(), args.file_path.clone()]);

    if audio_only {
        cmd_args.push("-vn".into());
    } else if let Some(ref codec) = args.codec {
        // Video codec
        if !codec.is_empty() {
            cmd_args.extend(["-c:v".into(), codec.clone()]);
        }
    }

    // Audio codec
    if let Some(encoder) = audio_encoder {
        cmd_args.extend(["-c:a".into(), encoder.into()]);
    } else if let Some(ref ac) = args.audio_codec {
        if !ac.is_empty() {
            cmd_args.extend(["-c:a".into(), ac.clone()]);
        }
    }

    // Resolution
    if let Some(ref res) = args.resolution {
        if !res.is_empty() && !audio_only {
            cmd_args.extend(["-s".into(), res.clone()]);
        }
    }

    // CRF
    if let Some(crf) = args.crf {
        if !audio_only {
            cmd_args.extend(["-crf".into(), crf.to_string()]);
        }
    }

    // Audio bitrate
    if let Some(ref ab) = args.audio_bitrate {
        if !ab.is_empty() && !is_lossless_audio(&args.output_format) {
            cmd_args.extend(["-b:a".into(), ab.clone()]);
        }
    }

    // FPS
    if let Some(ref fps) = args.fps {
        if let Ok(f) = fps.parse::<u32>() {
            if f > 0 && !audio_only {
                cmd_args.extend(["-r".into(), f.to_string()]);
            }
        }
    }

    // Progress output
    cmd_args.extend(["-progress".into(), "pipe:1".into()]);
    cmd_args.extend(["-y".into(), out_path.to_string_lossy().to_string()]);

    let mut child = match Command::new(&ffmpeg)
        .args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return MediaResult {
                success: false,
                output_path: None,
                error: Some(e.to_string()),
            }
        }
    };

    // Parse progress from stdout
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        let fp = args.file_path.clone();
        tokio::spawn(async move {
            // Get duration via ffprobe-like approach: parse from progress output
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut _out_time_us: f64 = 0.0;

            // Try to get duration from a quick ffprobe call
            let duration_secs = get_duration_secs(&app_clone, &fp).await.unwrap_or(0.0);

            while let Ok(Some(line)) = lines.next_line().await {
                if line.starts_with("out_time_us=") {
                    if let Ok(us) = line.trim_start_matches("out_time_us=").parse::<f64>() {
                        _out_time_us = us;
                        if duration_secs > 0.0 {
                            let percent = (us / 1_000_000.0 / duration_secs * 100.0).min(100.0);
                            let _ = app_clone.emit(
                                "video:progress",
                                serde_json::json!({ "percent": percent }),
                            );
                        }
                    }
                }
            }
        });
    }

    match child.wait().await {
        Ok(status) if status.success() => MediaResult {
            success: true,
            output_path: Some(out_path.to_string_lossy().to_string()),
            error: None,
        },
        Ok(_) => MediaResult {
            success: false,
            output_path: None,
            error: Some("ffmpeg exited with error".into()),
        },
        Err(e) => MediaResult {
            success: false,
            output_path: None,
            error: Some(e.to_string()),
        },
    }
}

async fn get_duration_secs(app: &AppHandle, file_path: &str) -> Option<f64> {
    let ffprobe = ffprobe_path(app);
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            file_path,
        ])
        .output()
        .await
        .ok()?;
    let s = String::from_utf8_lossy(&output.stdout);
    s.trim().parse::<f64>().ok()
}

// ── Audio Convert ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AudioConvertArgs {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "outputFormat")]
    pub output_format: String,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
    pub bitrate: Option<String>,
    #[serde(rename = "sampleRate")]
    pub sample_rate: Option<String>,
    pub channels: Option<String>,
    pub normalize: Option<bool>,
    #[serde(rename = "fadeIn")]
    pub fade_in: Option<f64>,
    #[serde(rename = "outputName")]
    pub output_name: Option<String>,
}

#[tauri::command]
pub async fn audio_convert(app: AppHandle, args: AudioConvertArgs) -> MediaResult {
    let ffmpeg = ffmpeg_path(&app);
    if !ffmpeg.exists() {
        return MediaResult {
            success: false,
            output_path: None,
            error: Some("ffmpeg binary not found in resources".into()),
        };
    }

    let safe_name = args
        .output_name
        .as_ref()
        .map(|n| sanitize(n.trim()))
        .unwrap_or_default();
    let base_name = if safe_name.is_empty() {
        Path::new(&args.file_path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    } else {
        safe_name
    };
    let out_path = PathBuf::from(&args.output_dir)
        .join(format!("{}.{}", base_name, args.output_format));

    let mut cmd_args: Vec<String> = vec!["-i".into(), args.file_path.clone()];

    if let Some(ref br) = args.bitrate {
        if !br.is_empty() {
            cmd_args.extend(["-b:a".into(), br.clone()]);
        }
    }

    if let Some(ref sr) = args.sample_rate {
        if let Ok(rate) = sr.parse::<u32>() {
            cmd_args.extend(["-ar".into(), rate.to_string()]);
        }
    }

    match args.channels.as_deref() {
        Some("mono") => cmd_args.extend(["-ac".into(), "1".into()]),
        Some("stereo") => cmd_args.extend(["-ac".into(), "2".into()]),
        _ => {}
    }

    // Audio filters
    let mut filters = Vec::new();
    if args.normalize.unwrap_or(false) {
        filters.push("loudnorm=I=-16:TP=-1.5:LRA=11".to_string());
    }
    if let Some(fade) = args.fade_in {
        if fade > 0.0 {
            filters.push(format!("afade=t=in:d={}", fade));
        }
    }
    if !filters.is_empty() {
        cmd_args.extend(["-af".into(), filters.join(",")]);
    }

    // Progress
    cmd_args.extend(["-progress".into(), "pipe:1".into()]);
    cmd_args.extend(["-y".into(), out_path.to_string_lossy().to_string()]);

    let mut child = match Command::new(&ffmpeg)
        .args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return MediaResult {
                success: false,
                output_path: None,
                error: Some(e.to_string()),
            }
        }
    };

    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        let fp = args.file_path.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let duration_secs = get_duration_secs(&app_clone, &fp).await.unwrap_or(0.0);

            while let Ok(Some(line)) = lines.next_line().await {
                if line.starts_with("out_time_us=") {
                    if let Ok(us) = line.trim_start_matches("out_time_us=").parse::<f64>() {
                        if duration_secs > 0.0 {
                            let percent = (us / 1_000_000.0 / duration_secs * 100.0).min(100.0);
                            let _ = app_clone.emit(
                                "audio:progress",
                                serde_json::json!({ "percent": percent }),
                            );
                        }
                    }
                }
            }
        });
    }

    match child.wait().await {
        Ok(status) if status.success() => MediaResult {
            success: true,
            output_path: Some(out_path.to_string_lossy().to_string()),
            error: None,
        },
        Ok(_) => MediaResult {
            success: false,
            output_path: None,
            error: Some("ffmpeg exited with error".into()),
        },
        Err(e) => MediaResult {
            success: false,
            output_path: None,
            error: Some(e.to_string()),
        },
    }
}

// ── Waveform ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn media_waveform(app: AppHandle, file_path: String) -> Vec<f32> {
    let ffmpeg = ffmpeg_path(&app);
    if !ffmpeg.exists() {
        return vec![];
    }

    let output = match Command::new(&ffmpeg)
        .args([
            "-i",
            &file_path,
            "-f",
            "f32le",
            "-ac",
            "1",
            "-ar",
            "8000",
            "-v",
            "quiet",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let buf = output.stdout;
    if buf.len() < 4 {
        return vec![];
    }

    let num_samples = buf.len() / 4;
    let samples: Vec<f32> = (0..num_samples)
        .map(|i| {
            let offset = i * 4;
            f32::from_le_bytes([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]])
        })
        .collect();

    let num_bars = 200usize;
    let per_bar = (samples.len() / num_bars).max(1);
    let mut peaks = Vec::with_capacity(num_bars);

    for i in 0..num_bars {
        let start = i * per_bar;
        let end = (start + per_bar).min(samples.len());
        let max = samples[start..end]
            .iter()
            .map(|s| s.abs())
            .fold(0.0f32, f32::max);
        peaks.push(max);
    }

    let max_peak = peaks.iter().cloned().fold(0.001f32, f32::max);
    peaks.iter().map(|p| p / max_peak).collect()
}

// ── Clip / Trim ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ClipArgs {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "startTime")]
    pub start_time: f64,
    #[serde(rename = "endTime")]
    pub end_time: f64,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
}

#[tauri::command]
pub async fn media_clip(app: AppHandle, args: ClipArgs) -> MediaResult {
    let ffmpeg = ffmpeg_path(&app);
    if !ffmpeg.exists() {
        return MediaResult {
            success: false,
            output_path: None,
            error: Some("ffmpeg binary not found in resources".into()),
        };
    }

    let ext = Path::new(&args.file_path)
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let base_name = Path::new(&args.file_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let s_label = args.start_time.round() as i64;
    let e_label = args.end_time.round() as i64;
    let clip_name = format!("{}_clip_{}s-{}s.{}", base_name, s_label, e_label, ext);
    let out_path = PathBuf::from(&args.output_dir).join(clip_name);

    let duration = args.end_time - args.start_time;

    let output = Command::new(&ffmpeg)
        .args([
            "-i",
            &args.file_path,
            "-ss",
            &args.start_time.to_string(),
            "-t",
            &duration.to_string(),
            "-c",
            "copy",
            "-y",
            &out_path.to_string_lossy(),
        ])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => MediaResult {
            success: true,
            output_path: Some(out_path.to_string_lossy().to_string()),
            error: None,
        },
        Ok(o) => MediaResult {
            success: false,
            output_path: None,
            error: Some(String::from_utf8_lossy(&o.stderr).to_string()),
        },
        Err(e) => MediaResult {
            success: false,
            output_path: None,
            error: Some(e.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_containers_are_not_audio_only() {
        // A false positive here would silently strip the picture out of every
        // ordinary conversion, so guard the real video formats explicitly.
        for f in ["mp4", "mkv", "avi", "mov", "webm"] {
            assert!(audio_only_encoder(f).is_none(), "{f} must keep its video track");
        }
    }

    #[test]
    fn audio_containers_pick_a_muxable_encoder() {
        assert_eq!(audio_only_encoder("mp3"), Some("libmp3lame"));
        assert_eq!(audio_only_encoder("m4a"), Some("aac"));
        assert_eq!(audio_only_encoder("wav"), Some("pcm_s16le"));
        assert_eq!(audio_only_encoder("flac"), Some("flac"));
        assert_eq!(audio_only_encoder("ogg"), Some("libopus"));
    }

    #[test]
    fn format_matching_ignores_case() {
        assert_eq!(audio_only_encoder("MP3"), Some("libmp3lame"));
        assert!(is_lossless_audio("WAV"));
    }

    #[test]
    fn only_lossless_targets_refuse_a_bitrate() {
        assert!(is_lossless_audio("wav"));
        assert!(is_lossless_audio("flac"));
        assert!(!is_lossless_audio("mp3"));
        assert!(!is_lossless_audio("m4a"));
        assert!(!is_lossless_audio("mp4"));
    }
}
