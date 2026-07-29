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

⚠️ **Audit findings** — full detail in [CLAUDE.md](CLAUDE.md) *Known Issues*
- 4 tools silently broken in packaged builds (ffmpeg not bundled)
- Waveform + inspector preview broken (`sk-media://` has no Rust handler)
- No tests, no CI, 7 dead assets

---

## Next steps

### 🔴 Blocks release — fix first
- [x] ~~**1. Bundle ffmpeg/ffprobe**~~ — done, see above
- [ ] **2. Replace `sk-media://`** with Tauri `convertFileSrc` ← *next*
      `src/components/WaveformPlayer.jsx:412`, `src/pages/FileInspector.jsx:295`
      *Unblocks: waveform playback, inspector media preview.*
- [ ] **3. Fix CSP + self-host fonts**
      `index.html` (meta CSP) vs `src-tauri/tauri.conf.json` (`app.security.csp`) disagree;
      neither allows `fonts.googleapis.com`, imported at `src/index.css:1`.
      *Fixes packaged-build styling and makes the "100% LOCAL" claim true.*

### 🟡 Unify
- [ ] **4. Platform abstraction** — `#[cfg(target_os)]` constants for binary names,
      download URLs, checksums, `chmod`
- [ ] **5. Merge `mac-rust` → `master`**, retire `win-rust` / `mac-dev` / `win-dev`
- [ ] **6. CI matrix** (`.github/workflows/release.yml`) — `macos-latest` + `windows-latest`
      build both installers on tag push

### 🟢 Polish
- [ ] **7. Cleanup** — delete 7 dead assets; `git rm --cached .claude/`, `src-tauri/gen/schemas/`
- [ ] **8. SHA-256 pin for Real-ESRGAN** — hash already computed:
      `e0ad05580abfeb25f8d8fb55aaf7bedf552c375b5b4d9bd3c8d59764d2cc333a`
- [ ] **9. First Rust unit tests** — filename sanitizing, ICO building, progress parsing

### 🔵 Needs your decision
- [ ] **10. Code signing** — $99/yr Apple Developer account (proper fix) vs shipping with
      "Open Anyway" instructions. Currently `signingIdentity: null`, so Gatekeeper blocks
      first launch; macOS 15 removed the right-click→Open bypass.
      *This is the only true blocker on public distribution.*

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
