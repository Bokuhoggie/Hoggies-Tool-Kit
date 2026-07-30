/**
 * Tauri Bridge — polyfills window.htk so that existing React components
 * continue to work without any changes. Replaces electron/preload.cjs.
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Helper: subscribe to Tauri events with the same API shape as ipcRenderer.on
function onEvent(channel, cb) {
  // listen() returns a promise that resolves to an unlisten function
  listen(channel, (event) => cb(event.payload));
}

function offEvent(_channel) {
  // We can't easily remove specific listeners with Tauri's API,
  // but we can track them. For now, this is a no-op since the
  // components handle their own lifecycle.
}

window.htk = {
  // File path from drag events — Tauri doesn't have webUtils,
  // but we can get the path from the File object if available
  getPathForFile: (file) => {
    // In Tauri, File objects from drag-and-drop include the path
    return file?.path || file?.name || '';
  },

  image: {
    convert:       (opts) => invoke('image_convert', { args: opts }),
    selectFiles:   ()     => invoke('image_select_files'),
    removeBg:      (opts) => invoke('image_remove_bg', { args: opts }),
    readAsDataURL: (path) => invoke('image_read_as_data_url', { filePath: path }),
    upscale:           (opts) => invoke('image_upscale', { args: opts }),
    onUpscaleSetup:    (cb)   => onEvent('upscale:setup', cb),
    onUpscaleProgress: (cb)   => onEvent('upscale:progress', cb),
    realesrganVersion: ()     => invoke('image_realesrgan_version'),
    realesrganUpdate:  ()     => invoke('image_realesrgan_update'),
  },

  video: {
    convert:     (opts) => invoke('video_convert', { args: opts }),
    selectFile:  ()     => invoke('video_select_file'),
    onProgress:  (cb)   => onEvent('video:progress', cb),
    offProgress: ()     => offEvent('video:progress'),
  },

  audio: {
    convert:     (opts) => invoke('audio_convert', { args: opts }),
    selectFiles: ()     => invoke('audio_select_files'),
    onProgress:  (cb)   => onEvent('audio:progress', cb),
    offProgress: ()     => offEvent('audio:progress'),
  },

  downloader: {
    download:      (opts) => invoke('downloader_download', { args: opts }),
    selectFolder:  ()     => invoke('downloader_select_folder'),
    onProgress:    (cb)   => onEvent('downloader:progress', cb),
    offProgress:   ()     => offEvent('downloader:progress'),
    onSetup:       (cb)   => onEvent('downloader:setup', cb),
    ytDlpVersion:  ()     => invoke('downloader_yt_dlp_version'),
    ytDlpUpdate:   ()     => invoke('downloader_yt_dlp_update'),
  },

  pdf: {
    merge:               (opts) => invoke('pdf_merge', { args: opts }),
    split:               (opts) => invoke('pdf_split', { args: opts }),
    compress:            (opts) => invoke('pdf_compress', { args: opts }),
    compressToSize:      (opts) => invoke('pdf_compress_to_size', { args: opts }),
    onCompressProgress:  (cb)   => onEvent('pdf:compressProgress', cb),
    offCompressProgress: ()     => offEvent('pdf:compressProgress'),
    fileSize:            (filePath) => invoke('pdf_file_size', { filePath }),
    toImages:            ()    => invoke('pdf_to_images'),
    selectFiles:         ()     => invoke('pdf_select_files'),
    selectFile:          ()     => invoke('pdf_select_file'),
  },

  hash: {
    compute:    (opts) => invoke('hash_compute', { args: opts }),
    selectFile: ()     => invoke('hash_select_file'),
  },

  shell: {
    openPath: (filePath) => invoke('shell_open_path', { path: filePath }),
  },

  selectOutputDir: () => invoke('select_output_dir'),

  settings: {
    read:  ()     => invoke('settings_read'),
    write: (data) => invoke('settings_write', { data }),
  },

  inspector: {
    analyze:    (filePath) => invoke('inspector_analyze', { filePath }),
    selectFile: ()         => invoke('inspector_select_file'),
  },

  stems: {
    separate:        (opts) => invoke('stems_separate', { args: opts }),
    onProgress:      (cb)   => onEvent('stems:progress', cb),
    onSetup:         (cb)   => onEvent('stems:setup', cb),
    offProgress:     ()     => offEvent('stems:progress'),
    demucsVersion:   ()     => invoke('stems_demucs_version'),
    demucsUpdate:    ()     => invoke('stems_demucs_update'),
  },

  media: {
    waveform: (filePath) => invoke('media_waveform', { filePath }),
    clip:     (opts)     => invoke('media_clip', { args: opts }),
    // Turn an absolute path into a URL the webview can load in <audio>/<video>/<embed>.
    // Replaces the Electron-era `sk-media://` protocol, which had no Tauri handler.
    fileUrl:  (filePath) => (filePath ? convertFileSrc(filePath) : ''),
  },

  getVersion: () => invoke('app_version'),

  updater: {
    // Updater will be handled by tauri-plugin-updater in the future
    // For now, stub these out
    check:    ()   => Promise.resolve(),
    download: ()   => Promise.resolve(),
    install:  ()   => Promise.resolve(),
    onUpdateAvailable: (_cb) => {},
    onNoUpdate:        (_cb) => {},
    onProgress:        (_cb) => {},
    onDownloaded:      (_cb) => {},
    onError:           (_cb) => {},
    offAll:            ()   => {},
  },
};
