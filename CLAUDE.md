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
- Xcode Command Line Tools (macOS) / MSVC build tools + WebView2 runtime (Windows)

> **Windows: never check out into a path containing an apostrophe.** `tauri-winres`
> escapes `'` as `\'` when it generates `resource.rc`, and RC.EXE then can't resolve the
> icon path — `error RC2135: file not found: …\Hoggie\'s Tool Kit\…\icon.ico`. It fails in
> the build script, before any app code compiles. Building through a junction at a clean
> path does *not* help; tauri-build canonicalizes the icon to its physical location.
> Use `…\Hoggies-Tool-Kit\`. CI is unaffected only because runners check out to
> `D:\a\Hoggies-Tool-Kit\Hoggies-Tool-Kit`.

> **`npm run ffmpeg:fetch` is required before *any* cargo command** — not just a bundle.
> `tauri-build` resolves the `resources` globs from `tauri.conf.json` inside `build.rs`
> and hard-fails if they match nothing, so even `cargo clippy` can't run without it.

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
verification and filename sanitizing in `upscale_commands.rs`, plus `platform.rs`. There
is no JS test runner.

CI (`.github/workflows/ci.yml`) runs lint + `clippy -D warnings` + `cargo test` +
`cargo check` on **macOS and Windows** for every push and PR. Note what it does *not* do:
it never bundles. Packaging bugs — anything in `tauri.conf.json`'s `bundle` block — get
through CI untouched, so they have to be caught by building an installer by hand.

Highest-value additions, in order:
1. More Rust unit tests for pure logic (ICO building, progress parsing, ffmpeg arg building)
2. A smoke test that every `#[tauri::command]` in `main.rs` has a `tauriBridge.js` binding

## Release builds

> **Keep ASCII apostrophes out of `productName`.** It is currently `"Hoggie’s Tool Kit"`
> with U+2019, and that is deliberate. An ASCII `'` breaks the Windows build two ways:
> NSIS treats it as a string delimiter and dies with
> `macro "NSISCOMCALL" requires 4 parameter(s), passed 8!`, and tauri-winres escapes it
> into the version info so the shipped `.exe` reports `Hoggie\'s Tool Kit` in
> Properties → Details. The `.msi` builds either way — only NSIS fails — so a release can
> lose half its Windows artifacts while looking fine. U+2019 avoids both and is the
> correct apostrophe anyway. The in-app window `title` is unaffected; it never reaches a
> packager.

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
- [ ] **Not code-signed or notarized** (`signingIdentity: null`). Gatekeeper blocks first
      launch on macOS; Sequoia removed the right-click→Open bypass. *Planned — pending an
      Apple Developer account.*

### Recently fixed (kept for context)
- [x] **ffmpeg/ffprobe now bundled** via `npm run ffmpeg:fetch` (pinned SHA-256, lipo'd
      universal on macOS). Binaries are gitignored; the fetch runs before dev/build.
- [x] **`sk-media://` replaced** by the Tauri asset protocol behind `htk.media.fileUrl()`.
- [x] **CSPs reconciled.** `index.html` and `tauri.conf.json` are now a matched pair —
      browsers apply the *intersection*, so both must allow a directive for it to work.
- [x] **Fonts self-hosted** in `src/assets/fonts/` (latin woff2, SIL OFL). No remote
      origins remain in either CSP.

### Polish
- [x] ~~Dead assets, tracked `.claude/`, tracked `src-tauri/gen/schemas/`~~ — all cleaned
      up; verified absent from the working tree and the index.
- [x] ~~`useSettings.js` docblock said "backed by electron IPC"~~ — now names the Tauri bridge.
- [ ] Test auto-updater with `tauri-plugin-updater` (currently stubbed in `tauriBridge.js`).
- [ ] `.title-bar` reserves `padding-left: 80px` for macOS traffic lights, but the window
      is `decorations: false` on both platforms, so it's dead space on Windows. Cosmetic —
      confirm against a running macOS build before changing it.

## Arbor — the project library

[Arbor](http://timone:3003) is the developer portal on **timone**: project
timelines, handoff records ("batons"), and the documentation for every project
across all three machines. It is reachable over Tailscale only.

**This project is `htk` in Arbor.**

Its code is **not** cloned on timone, so its documentation lives in Arbor's own
storage rather than in this repo. Arbor is the canonical copy — if you write a
design note or a plan, put it there, not in a loose markdown file here.

### Reading it

If you have the Arbor MCP server configured, use `arbor_search` / `arbor_read_doc`
and you are done. Otherwise, over HTTP:

```bash
export ARBOR_TOKEN=$(ssh timone@timone "grep '^ARBOR_TOKEN=' ~/arbor/.env | cut -d= -f2-")
curl -s -G -H "x-arbor-token: $ARBOR_TOKEN" \
  --data-urlencode "q=notarization" http://timone:3003/api/search
```

**Search Arbor before reconstructing history from `git log`.** Decisions and
plans are written down there; the commit log records what changed, not why.

### Writing to it

Documents are **standalone HTML**. Send only the body — no `<!doctype>`, `<html>`,
`<head>`, `<style>` or `<title>`; Arbor wraps it and renders the title itself.
Start headings at `h2`. Scripts and inline styles are stripped server-side.

`CLAUDE.md`, `AGENTS.md` and `README.md` are never converted and never writable
through the API — coding agents and GitHub read those, so they stay markdown.
**This file is one of them: edit it here, on disk.**

Writing a document **overwrites** it. Read it first and merge, or you will
replace work you never saw.

Full API and conventions: `~/arbor/AGENTS.md` on timone.
