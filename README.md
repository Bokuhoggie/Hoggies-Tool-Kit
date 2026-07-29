# Hoggie's Tool Kit (HTK)

An all-in-one desktop utility app for file conversion and media wrangling. Everything runs
locally on your machine — no accounts, no uploads, no telemetry.

Built with [Tauri v2](https://tauri.app) (Rust backend) and React + Vite (frontend).

## Tools

| Tool | What it does |
|------|--------------|
| **Image Converter** | Convert between JPG, PNG, WebP, AVIF, GIF, BMP, TIFF, ICO. Resize, multi-size `.ico` generation. |
| **Remove BG** | Background removal via edge flood-fill or colour matching, with an eyedropper picker. |
| **Upscale** | AI super-resolution (Real-ESRGAN) at 2×/3×/4× — photo, anime, and anime-video models. |
| **Video Converter** | Format/codec conversion via ffmpeg, with progress reporting. |
| **Audio Converter** | Audio format conversion via ffmpeg. |
| **Stem Separator** | Split a track into vocals/drums/bass/other using demucs. |
| **Downloader** | Video/audio downloads via yt-dlp. |
| **PDF Tools** | Merge, split, and compress PDFs. |
| **File Hasher** | SHA-256 / SHA-1 / MD5 checksums. |
| **File Inspector** | Inspect metadata and hand files off to the right tool. |

## Install

Download the latest release for your platform from the
[Releases page](https://github.com/Bokuhoggie/Hoggies-Tool-Kit/releases).

- **macOS** — `.dmg`. Open it and drag the app to Applications. The macOS build is a
  *universal binary*: one download works on both Apple Silicon and Intel, and macOS
  selects the right architecture at launch.
- **Windows** — `.msi` or `.exe` installer.

### ⚠️ macOS: "unidentified developer" warning

HTK is not yet code-signed or notarized by Apple, so Gatekeeper will block it on first
launch. To open it:

1. Try to open the app once (you'll get a warning).
2. Go to **System Settings → Privacy & Security**.
3. Scroll to the security section and click **Open Anyway**.

> On macOS 15 (Sequoia) and later, the old right-click → Open shortcut no longer works —
> you must use the Privacy & Security panel.

## First-run downloads

To keep the installer small, some optional engines are fetched on first use and cached in
your app-data directory:

| Engine | Used by | Size |
|--------|---------|------|
| yt-dlp | Downloader | ~30 MB |
| demucs | Stem Separator | ~10 MB (+ models on demand) |
| Real-ESRGAN | Upscale | ~50 MB |

These need an internet connection the first time only. `ffmpeg`/`ffprobe` are bundled with
the app and always available offline.

## Building from source

### Prerequisites

- **Rust** (stable) — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node.js** v18+
- Platform build tools: Xcode Command Line Tools (macOS) or the MSVC build tools (Windows)

For a universal macOS build you also need both Rust targets:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

### Commands

```bash
npm install            # install JS dependencies
npm run tauri:dev      # run in development (Vite + Tauri)
npm run tauri:build    # build for the current platform
npm run lint           # ESLint
```

macOS universal build:

```bash
npm run tauri:build:mac
```

> Installers are per-platform by nature: a `.dmg` can only be produced on macOS and a
> `.msi` only on Windows. Release builds are produced by a CI matrix that runs both.

## Project layout

```
src/                    React frontend
  pages/                one page per tool
  components/           HtkWidget (nav), WaveformPlayer, Icons
  contexts/             ThemeContext (themes, sizes, fonts)
  tauriBridge.js        maps window.htk.* onto Tauri invoke()
src-tauri/              Rust backend
  src/commands/         one module per tool domain
  resources/            bundled binaries (ffmpeg, ffprobe)
  capabilities/         Tauri permission capabilities
  tauri.conf.json       window, bundle, and CSP config
```

The frontend never calls Rust directly: every native operation goes through
`window.htk.*` in [`src/tauriBridge.js`](src/tauriBridge.js), which maps onto a
`#[tauri::command]` registered in [`src-tauri/src/main.rs`](src-tauri/src/main.rs).

## Privacy

All processing happens on your machine. HTK does not upload your files anywhere. The only
outbound network requests are:

- downloading the optional engines listed above, on first use
- yt-dlp fetching a URL you explicitly asked it to download

## License

See [LICENSE](LICENSE).
