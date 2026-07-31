# 🏃 BATON — HTK Release Handoff

Working state and next steps. Update this as work lands so any session (or person) can
pick up cold.

**Last updated:** 2026-06-20
**Branch:** `mac-rust` · **Version:** 1.1.0 · **Target:** unify to `master`, ship both platforms

---

## Where things stand

✅ **Done**
- AI image upscaling (Real-ESRGAN) — committed `9a6c709`, engine verified natively on Apple Silicon
- Version aligned to 1.1.0 (package.json / Cargo.toml / tauri.conf.json)
- README rewritten (was still the stock Vite template)
- CLAUDE.md rewritten around unified branching + real Known Issues
- **ffmpeg/ffprobe bundling** — `scripts/fetch-ffmpeg.mjs` fetches static builds with
  pinned SHA-256, lipo'd into universal binaries, wired into `resources` + auto-run
  before dev/build. Verified: mp3/AAC encode, ffprobe JSON, libx264/x265 present.
  **End-to-end verified**: built a real `.dmg`, mounted it, confirmed universal
  ffmpeg/ffprobe ship at `Contents/Resources/resources/`.
- **Real-ESRGAN checksum pinning** — SHA-256 verified before extraction on both
  platforms; fails closed if a pin is missing. Platform-aware binary name (`.exe`).
- **First tests** — `npm test` (5 passing: checksum verification, sanitizing).
- **`sk-media://` → Tauri asset protocol** — `htk.media.fileUrl()` wraps
  `convertFileSrc()`; `assetProtocol` enabled (+ `protocol-asset` cargo feature); both
  CSPs reconciled. Fixes waveform playback (Audio/Video/Inspector) and PDF preview.

⚠️ **Audit findings** — full detail in [CLAUDE.md](CLAUDE.md) *Known Issues*
- 4 tools silently broken in packaged builds (ffmpeg not bundled)
- Waveform + inspector preview broken (`sk-media://` has no Rust handler)
- No tests, no CI, 7 dead assets

---

## Next steps

### 🔴 Blocks release — fix first
- [x] ~~**1. Bundle ffmpeg/ffprobe**~~ — done, verified inside a built `.dmg`
- [x] ~~**2. Replace `sk-media://`**~~ — done. ⚠️ *Code-complete but the UI path was
      never clicked through:* confirm a waveform actually renders + plays, and that the
      inspector PDF preview loads. Everything around it is verified (asset protocol
      compiled in, CSPs allow `asset:`, app launches clean).
      `src/components/WaveformPlayer.jsx:412`, `src/pages/FileInspector.jsx:295`
      *Unblocks: waveform playback, inspector media preview.*
- [x] ~~**3. Self-host fonts**~~ — done. Latin woff2 subsets vendored in
      `src/assets/fonts/` (59 KB total, SIL OFL, committed); `npm run fonts:fetch`
      refreshes them. Google allowances removed from **both** CSPs. Verified: fonts are
      embedded in the release binary and zero `fonts.g*` URLs remain in it.

### 🟡 Unify
- [ ] **4. Platform abstraction** — `#[cfg(target_os)]` constants for binary names,
      download URLs, checksums, `chmod`
- [ ] **5. Merge `mac-rust` → `master`**, retire `win-rust` / `mac-dev` / `win-dev`
- [ ] **6. CI matrix** (`.github/workflows/release.yml`) — `macos-latest` + `windows-latest`
      build both installers on tag push

### 🟢 Polish
- [ ] **7. Cleanup** — delete 7 dead assets; `git rm --cached .claude/`, `src-tauri/gen/schemas/`
- [x] ~~**8. SHA-256 pin for Real-ESRGAN**~~ — done, both platforms
- [~] **9. Rust unit tests** — started (5 tests). Still want: ICO building,
      progress parsing, command↔bridge parity smoke test

### 🔵 Needs your decision
- [ ] **10. Code signing** — **planned, pending funds.** Apple Developer account ($99/yr),
      then set `signingIdentity` + notarize. Until then the README documents the
      "Open Anyway" workaround (macOS 15 removed the right-click→Open bypass).
      When the account lands, certs go in **GitHub Secrets** so CI signs during the build
      and they never sit on a laptop.

---

## Verified reference

Facts established by direct testing — don't re-investigate:

- **Real-ESRGAN macOS binary is universal** (x86_64 + arm64) → runs natively on Apple
  Silicon GPU. No Rosetta concern.
- Real-ESRGAN progress percentages go to **stderr**, not stdout.
- `realesrgan-x4plus` handles 2×/3×/4× correctly (exact ratios); only
  `realesr-animevideov3` needs per-scale model variants.
- Both Rust targets (`aarch64-apple-darwin`, `x86_64-apple-darwin`) are installed locally.
- A `.dmg` is not an installer — it's a disk image. Universal binaries carry both
  architectures and macOS picks the slice at launch. One download serves every Mac.
- **`npm run tauri:build` fails at the DMG step outside a GUI session** —
  `bundle_dmg.sh` calls `osascript` to prettify the Finder window. Use
  `CI=true npm run tauri:build`. GitHub Actions sets `CI` itself, so CI is fine.
- Homebrew ffmpeg links 56 dylibs out of `/opt/homebrew/Cellar` — not bundleable.
  Static builds come from `eugeneware/ffmpeg-static` (GitHub exposes SHA-256 digests
  via `gh api …releases/latest --jq '.assets[].digest'`).
