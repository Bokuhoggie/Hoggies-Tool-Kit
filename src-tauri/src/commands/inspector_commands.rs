use std::collections::HashMap;
use std::fs;
use std::path::Path;

use image::GenericImageView;
use serde::Serialize;
use tauri::AppHandle;

use super::media_commands::ffmpeg_path;

#[derive(Serialize)]
pub struct FileAnalysis {
    pub name: String,
    pub path: String,
    pub ext: String,
    pub mime: String,
    pub size: u64,
    #[serde(rename = "sizeStr")]
    pub size_str: String,
    pub modified: String,
    pub created: String,
    #[serde(rename = "suggestedTool")]
    pub suggested_tool: Option<String>,
    #[serde(rename = "suggestedToolLabel")]
    pub suggested_tool_label: Option<String>,
    pub category: Option<String>,
    pub details: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.2} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

fn ext_to_mime(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "heic" => "image/heic",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "opus" => "audio/opus",
        "wma" => "audio/x-ms-wma",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "flv" => "video/x-flv",
        "wmv" => "video/x-ms-wmv",
        "m4v" => "video/x-m4v",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "rar" => "application/x-rar",
        "7z" => "application/x-7z-compressed",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "html" => "text/html",
        "css" => "text/css",
        "js" | "jsx" => "text/javascript",
        "py" => "text/x-python",
        _ => "application/octet-stream",
    }
}

fn ext_to_tool(ext: &str) -> Option<(&'static str, &'static str)> {
    match ext {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "tif" | "avif" => {
            Some(("/image", "Image Converter"))
        }
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "opus" | "wma" => {
            Some(("/audio", "Audio Converter"))
        }
        "mp4" | "mkv" | "avi" | "mov" | "webm" | "flv" | "wmv" | "m4v" => {
            Some(("/video", "Video Converter"))
        }
        "pdf" => Some(("/pdf", "PDF Tools")),
        _ => None,
    }
}

fn parse_media_info(stderr: &str) -> HashMap<String, String> {
    let mut info = HashMap::new();

    // Duration
    let re_dur = regex_lite::Regex::new(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)").ok();
    if let Some(re) = re_dur {
        if let Some(caps) = re.captures(stderr) {
            let h: f64 = caps[1].parse().unwrap_or(0.0);
            let m: f64 = caps[2].parse().unwrap_or(0.0);
            let s: f64 = caps[3].parse().unwrap_or(0.0);
            let _total = h * 3600.0 + m * 60.0 + s;
            info.insert(
                "Duration".into(),
                format!(
                    "{:02}:{:02}:{:02}",
                    h as u32,
                    m as u32,
                    s as u32
                ),
            );
        }
    }

    // Bitrate
    if let Some(idx) = stderr.find("bitrate:") {
        let rest = &stderr[idx + 8..];
        let end = rest.find("kb/s").unwrap_or(rest.len());
        let br = rest[..end].trim();
        if !br.is_empty() {
            info.insert("Bitrate".into(), format!("{} kb/s", br));
        }
    }

    // Video stream
    if stderr.contains("Video:") {
        // Codec
        let re_vc = regex_lite::Regex::new(r"Video:\s*([^\s,]+)").ok();
        if let Some(re) = re_vc {
            if let Some(caps) = re.captures(stderr) {
                info.insert("Video Codec".into(), caps[1].to_string());
            }
        }
        // Resolution
        let re_res = regex_lite::Regex::new(r"(\d{2,5}x\d{2,5})").ok();
        if let Some(re) = re_res {
            if let Some(caps) = re.captures(stderr) {
                info.insert("Resolution".into(), caps[1].to_string());
            }
        }
        // FPS
        let re_fps = regex_lite::Regex::new(r"(\d+(?:\.\d+)?)\s*fps").ok();
        if let Some(re) = re_fps {
            if let Some(caps) = re.captures(stderr) {
                info.insert("Frame Rate".into(), format!("{} fps", &caps[1]));
            }
        }
    }

    // Audio stream
    let re_aud = regex_lite::Regex::new(r"Audio:\s*([^\s,]+),\s*(\d+)\s*Hz,\s*([^\n,]+)").ok();
    if let Some(re) = re_aud {
        if let Some(caps) = re.captures(stderr) {
            info.insert("Audio Codec".into(), caps[1].to_string());
            if let Ok(hz) = caps[2].parse::<f64>() {
                info.insert("Sample Rate".into(), format!("{:.1} kHz", hz / 1000.0));
            }
            info.insert("Channels".into(), caps[3].trim().to_string());
        }
    }

    info
}

#[tauri::command]
pub async fn inspector_analyze(app: AppHandle, file_path: String) -> FileAnalysis {
    let p = Path::new(&file_path);
    let name = p
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = p
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    let stat = match fs::metadata(&file_path) {
        Ok(s) => s,
        Err(e) => {
            return FileAnalysis {
                name,
                path: file_path,
                ext,
                mime: String::new(),
                size: 0,
                size_str: String::new(),
                modified: String::new(),
                created: String::new(),
                suggested_tool: None,
                suggested_tool_label: None,
                category: None,
                details: HashMap::new(),
                error: Some(e.to_string()),
            };
        }
    };

    let mime = ext_to_mime(&ext).to_string();
    let tool = ext_to_tool(&ext);
    let size = stat.len();

    let modified = stat
        .modified()
        .ok()
        .map(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|| "—".into());

    let created = stat
        .created()
        .ok()
        .map(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|| "—".into());

    let mut details = HashMap::new();
    let mut category = None;

    // Image analysis
    if mime.starts_with("image/") && ext != "svg" && ext != "ico" {
        category = Some("image".to_string());
        if let Ok(reader) = image::ImageReader::open(&file_path) {
            if let Ok(img) = reader.decode() {
                let (w, h) = img.dimensions();
                details.insert("Dimensions".into(), format!("{} x {} px", w, h));
                details.insert("Format".into(), ext.to_uppercase());
            }
        }
    }
    // Audio / Video analysis via ffmpeg
    else if mime.starts_with("audio/") || mime.starts_with("video/") {
        category = Some(if mime.starts_with("audio/") {
            "audio"
        } else {
            "video"
        }.to_string());

        let ffmpeg = ffmpeg_path(&app);
        if ffmpeg.exists() {
            if let Ok(output) = std::process::Command::new(&ffmpeg)
                .args(["-i", &file_path, "-hide_banner"])
                .output()
            {
                let stderr = String::from_utf8_lossy(&output.stderr);
                details = parse_media_info(&stderr);
            }
        }
    }
    // PDF analysis
    else if mime == "application/pdf" {
        category = Some("pdf".to_string());
        if let Ok(doc) = lopdf::Document::load(&file_path) {
            details.insert("Pages".into(), doc.get_pages().len().to_string());
        }
    }

    FileAnalysis {
        name,
        path: file_path,
        ext: if ext.is_empty() { "(none)".into() } else { ext },
        mime,
        size,
        size_str: format_bytes(size),
        modified,
        created,
        suggested_tool: tool.map(|(t, _)| t.to_string()),
        suggested_tool_label: tool.map(|(_, l)| l.to_string()),
        category,
        details,
        error: None,
    }
}
