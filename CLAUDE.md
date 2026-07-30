# CLAUDE.md — Hoggie's Tool Kit (HTK) Project Guide

## Project Overview
HTK is an all-in-one Tauri v2 (Rust) + React (Vite) desktop utility app. All processing is
local. Tools:

- Image conversion, background removal, and AI upscaling (Real-ESRGAN)
- Video + audio conversion (ffmpeg via `tokio::process`)
- Stem separation (demucs)
- Video/audio downloader (yt-dlp)
- PDF tools (`lopdf`: merge, split, compress)
- File hasher / inspector (`sha2`, `sha1`, `md-5`)

## Branch Strategy

**Single cross-platform source of truth.** Platform differences live behind
`#[cfg(target_os = ...)]` and per-platform constants — *not* in separate branches.

| Branch | Purpose |
|--------|---------|
| `master` | Stable release branch, builds for both macOS and Windows |
| feature branches | Short-lived, merged back into `master` |

> **History:** the project previously used long-lived `win-dev` / `mac-dev` (Electron) and
> `win-rust` / `mac-rust` (Tauri) forks. That approach failed — `mac-rust` drifted 22
> commits ahead of `win-rust`, leaving Windows without the stem separator, the upscaler,
> the yt-dlp security fixes, and the v1.0.2 polish pass. Those branches are retained for
> history only. **Do not add new platform forks.**

Installers are inherently per-platform (a `.dmg` requires macOS, a `.msi` requires
Windows), but that is a *build* concern handled by the CI matrix — not a source concern.

## Dev & Build Commands
```
npm install                    # Install JS dependencies
npm run tauri:dev              # Dev mode — starts Vite + Tauri together
npm run tauri:build            # Build for current platform
npm run tauri:build:mac        # Universal macOS binary (arm64 + x64)
npm run lint                   # ESLint
```

### Prerequisites
- **Rust** (stable) via rustup; for universal macOS builds:
  `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
- **Node.js** v18+
- Xcode Command Line Tools (macOS) / MSVC build tools (Windows)

## Project Structure
```
src-tauri/
  src/
    main.rs              # Tauri entry point + invoke_handler registry
    commands/
      mod.rs             # Module declarations
      media_commands.rs  # Video/audio convert, waveform, clip (ffmpeg)
      image_commands.rs  # Image convert + remove BG (image crate)
      upscale_commands.rs # Real-ESRGAN upscaling (auto-downloaded engine)
      download_commands.rs # yt-dlp downloader
      stems_commands.rs  # demucs stem separation
      pdf_commands.rs    # PDF merge/split/compress (lopdf)
      hash_commands.rs   # File hashing
      inspector_commands.rs # File inspector
      dialog_commands.rs # Native file/folder dialogs
      settings_commands.rs # Persistent settings (JSON file)
  Cargo.toml
  tauri.conf.json        # Window, bundle, CSP config
  capabilities/          # Tauri permission capabilities
  resources/             # Bundled binaries (ffmpeg, ffprobe)
src/
  tauriBridge.js         # Polyfills window.htk → Tauri invoke()
  pageCache.js           # Module-level page state cache
  pages/                 # One React page per tool
  components/            # HtkWidget, WaveformPlayer, Icons
  contexts/              # ThemeContext
  App.jsx                # Router + layout
  main.jsx               # Entry (imports tauriBridge.js first)
```

## Code Style Guidelines
- **JavaScript/React**: functional components with hooks
- **Rust**: all native ops in `src-tauri/src/commands/`, one module per domain
- **Bridge layer**: every native call goes through `window.htk.*` in `tauriBridge.js`.
  Adding a command means touching three places: the command module, the `invoke_handler`
  list in `main.rs`, and `tauriBridge.js`.
- **CSS**: plain CSS in `src/index.css`, `sk-` class prefix for widget components
- **Paths**: use `std::path::PathBuf` — never string-concatenate paths
- **Downloaded binaries**: chmod 0o755 under `#[cfg(unix)]`; verify a pinned SHA-256
  before executing anything fetched at runtime

### Platform-specific code
Use `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "windows")]` for the small set of
real differences: binary names (`.exe` suffix), download URLs and their checksums, and
`chmod`. Keep these constants together rather than scattering `cfg` blocks through logic.

## External engine pattern
`yt-dlp`, `demucs`, and Real-ESRGAN are downloaded on first use into `app_data_dir` rather
than bundled, to keep the installer small. The established pattern (see
`upscale_commands.rs`) is:

1. Check for an existing install; return early if present
2. Download to a **staging** dir, verify checksum, extract
3. Atomically move into the final path, then chmod
4. **Roll back all partial artifacts on any failure** — a half-written binary must never
   pass the "already installed" check
5. Emit `<tool>:setup` events (`downloading` / `extracting` / `ready`) for the UI

`ffmpeg`/`ffprobe` are the exception: they are **bundled** in `resources/`, because nearly
every media tool depends on them and they must work offline.

## Testing
`npm test` runs the Rust suite (`cargo test`). Coverage is currently thin — checksum
verification and filename sanitizing in `upscale_commands.rs`. There is no JS test runner
and no CI yet.

Highest-value additions, in order:
1. More Rust unit tests for pure logic (ICO building, progress parsing, ffmpeg arg building)
2. A smoke test that every `#[tauri::command]` in `main.rs` has a `tauriBridge.js` binding
3. CI running `cargo test`, `cargo clippy`, and `npm run lint` on every push

## Release builds

> **`bundle_dmg.sh` fails outside a GUI session.** It shells out to `osascript` to
> prettify the DMG's Finder window, which fails in a background shell, over SSH, or in
> CI — the `.app` builds fine but the `.dmg` step aborts. Set `CI=true` to skip that
> cosmetic step:
>
> ```
> CI=true npm run tauri:build
> ```
>
> GitHub Actions sets `CI=true` automatically, so hosted runners are unaffected.

## Known Issues / TODO

### Blocking release
- [ ] **ffmpeg/ffprobe are not bundled.** `resources/` holds only `.gitkeep` and
      `tauri.conf.json` has `"resources": []`, but `media_commands.rs` resolves ffmpeg
      *only* at `resource_dir/resources/ffmpeg` with no PATH fallback. Video conversion,
      audio conversion, waveform, clip, and the downloader's merge step all fail in a
      packaged build.
- [ ] **`sk-media://` protocol is dead.** `WaveformPlayer.jsx` and `FileInspector.jsx`
      still build `sk-media://file?path=…` URLs, but no handler is registered in Rust
      (it was an Electron-era protocol). Waveform playback and inspector media preview
      are broken. Either register a Tauri URI scheme or switch to `convertFileSrc`/data URLs.
- [ ] **CSP mismatch.** `index.html` declares a meta CSP referencing `htk-media:` while
      `tauri.conf.json` declares a different one allowing `asset:`. Neither permits
      `fonts.googleapis.com`, which `src/index.css` imports on line 1 — the pixel fonts
      may not load in a packaged build.
- [ ] **Not code-signed or notarized** (`signingIdentity: null`). Gatekeeper blocks first
      launch on macOS; Sequoia removed the right-click→Open bypass.

### Polish
- [ ] `index.css` fetches Google Fonts remotely, which contradicts the "100% LOCAL /
      NO UPLOADS" claim on the home screen. Self-host the fonts.
- [ ] Dead assets: `swiss_knife_logo_red_white_*.png` (root), `src/assets/hero.png`,
      `src/assets/react.svg`, `src/assets/vite.svg`, `public/icons.svg`,
      `public/favicon.svg`, `public/icon.ico` — all unreferenced.
- [ ] `.claude/settings.local.json` is tracked despite `.gitignore` listing `.claude`
      (`git rm --cached` it).
- [ ] `src-tauri/gen/schemas/` is generated output but tracked in git.
- [ ] `useSettings.js` docblock still says "backed by electron IPC".
- [ ] Test auto-updater with `tauri-plugin-updater` (currently stubbed in `tauriBridge.js`).
