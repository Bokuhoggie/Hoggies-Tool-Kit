// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::dialog_commands::*;
use commands::download_commands::*;
use commands::hash_commands::*;
use commands::image_commands::*;
use commands::inspector_commands::*;
use commands::media_commands::*;
use commands::pdf_commands::*;
use commands::settings_commands::*;
use commands::stems_commands::*;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the existing window when a second instance tries to start
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            // Hash
            hash_compute,
            // Settings
            settings_read,
            settings_write,
            // Image
            image_convert,
            image_read_as_data_url,
            image_remove_bg,
            // Video
            video_convert,
            // Audio
            audio_convert,
            // Media (waveform + clip)
            media_waveform,
            media_clip,
            // PDF
            pdf_merge,
            pdf_split,
            pdf_compress,
            pdf_compress_to_size,
            pdf_file_size,
            pdf_to_images,
            // Downloader
            downloader_download,
            downloader_yt_dlp_version,
            downloader_yt_dlp_update,
            // Stems
            stems_separate,
            stems_demucs_version,
            stems_demucs_update,
            // Inspector
            inspector_analyze,
            // Dialogs
            select_output_dir,
            image_select_files,
            video_select_file,
            audio_select_files,
            pdf_select_files,
            pdf_select_file,
            hash_select_file,
            inspector_select_file,
            downloader_select_folder,
            // Shell
            shell_open_path,
            // App
            app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn shell_open_path(path: String) {
    let _ = opener::reveal(path);
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

use tauri::Manager;
