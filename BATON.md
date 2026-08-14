# 🏃 BATON — HTK Release Handoff

Working state and next steps. Update this as work lands so any session (or person) can
pick up cold.

**Last updated:** 2026-08-12
**Branch:** `master` (unified) · **Version:** 1.1.0

> **All three release-blocking bugs are fixed and the unify is done.** `master` is now the
> single cross-platform source of truth. What remains: push + let CI verify Windows,
> more tests (#9), and code signing (#10, pending an Apple Developer account).

> ✅ **Pushed, and CI is green on macOS *and* Windows.** The Windows job compiling clean
> is the first time this codebase has ever built for Windows — the unify is verified, not
> just asserted.

> 🪟 **First real Windows *workstation* bring-up is now in progress** (2026-08-12) — CI
> green is necessary but not sufficient. See **Windows bring-up** below: two issues that a
> GitHub runner structurally cannot catch, one of them a shipping blocker.

---

## Windows bring-up (2026-08-12)

The Windows dev machine moved off the abandoned `win-rust` fork onto `master`.

✅ **Windows now builds, tests, and packages end to end.** `clippy -D warnings` clean,
7/7 `cargo test` passing, and a working `.msi` + NSIS `-setup.exe` — the first Windows
installers this project has ever produced.

Getting there surfaced three bugs, **none of which CI could have caught**: two because CI
never bundles, one because it only ever checks out to an apostrophe-free path. Two of the
three would have shipped broken Windows artifacts from a green pipeline.

### 🔴 1. `bundle.targets` was macOS-only — the Windows installer was never built

`tauri.conf.json` had `"targets": ["dmg", "app"]`. Both are macOS package types.
tauri-bundler intersects the requested targets with the ones the host OS supports, so on
`windows-latest` that intersection is **empty** — `release.yml`'s Windows job would have
completed "successfully" and attached **no `.msi` and no `.nsis`** to the draft release.

`ci.yml` never caught it because CI stops at `clippy` / `test` / `cargo check` — it never
bundles. `release.yml` has not been run since the matrix was added, so nothing has ever
exercised the Windows bundle path.

**Fixed and verified:** `"targets": "all"`, which resolves per-host (macOS → `app` + `dmg`,
Windows → `msi` + `nsis`). A real `.msi` and `-setup.exe` now build on the Windows box.
Extracted the `.msi` with `msiexec /a` and confirmed `resources\ffmpeg.exe` +
`resources\ffprobe.exe` ship inside it — the Windows counterpart of the mounted-`.dmg`
check already done for macOS.

### 🔴 2. An apostrophe in the checkout path breaks the Windows build (environment, not repo)

`tauri-winres` writes the icon path into a generated `resource.rc` and escapes `'` as
`\'`. RC.EXE does not accept that escape, so it resolves the path literally and fails:

```
resource.rc(26) : error RC2135 : file not found:
  C:\...\Github\Hoggie\'s Tool Kit\src-tauri\icons\icon.ico
```

Any checkout directory containing an apostrophe fails this way, before a single line of
app code compiles. CI is immune purely by accident of naming — runners check out to
`D:\a\Hoggies-Tool-Kit\Hoggies-Tool-Kit`.

Confirmed not to be a path-quoting bug on our side: building through a junction at an
apostrophe-free path **still fails**, because tauri-build canonicalizes the icon to its
physical location. There is no path trick around it.

**Fix: keep apostrophes out of the checkout path.** The Windows working copy is
`…\Github\Hoggies-Tool-Kit\`, matching the GitHub repo name. This is a workstation
convention, not a repo change — nothing was patched for it, and nothing should be.

### 🔴 3. The apostrophe in `productName` broke the NSIS installer — fixed with U+2019

Separate from the path problem, and **not local-only: this one would have failed CI too**,
since it comes from `productName` in `tauri.conf.json`. It hid behind issue 1 — with
`targets` set to macOS-only, the Windows bundle path never ran, so nothing ever tripped it.

Two distinct symptoms from one ASCII `'`:

1. **NSIS failed outright.** NSIS treats `'` as a string delimiter, so the apostrophe
   split a macro's arguments:
   ```
   !insertmacro: macro "NSISCOMCALL" requires 4 parameter(s), passed 8!
   Error in macro IsShortcutTarget on macroline 11
   ```
   The `.msi` built fine; only the `-setup.exe` died. A release would have shipped
   half its Windows artifacts.
2. **tauri-winres escaped it into the version info**, and it *did* ship — confirmed on the
   built binary, not assumed:
   ```
   ProductName : [Hoggie\'s Tool Kit]      ← literal backslash, in Properties → Details
   ```

**Fix:** `productName` now uses U+2019 (`’`) instead of ASCII `'` — `"Hoggie’s Tool Kit"`.
NSIS doesn't treat U+2019 as a delimiter and tauri-winres doesn't escape it. Verified:
both installers build, and the exe reports `ProductName : [Hoggie’s Tool Kit]` cleanly.
It's also the typographically correct apostrophe, so the branding reads better, not worse.

⚠️ **macOS side, please confirm:** this renames the app bundle to `Hoggie’s Tool Kit.app`
and changes the `.dmg` name. Expected to be harmless — U+2019 is legal in HFS+/APFS
filenames and macOS has no NSIS — but it has not been built on a Mac since the change.
The in-app window title (`app.windows[0].title`) still uses the ASCII apostrophe and is
unaffected; it never reaches a packager.

### 🟢 4. Also fixed: Safari offered as a cookie source on Windows

`Downloader.jsx` listed Safari in the "Browser Cookies" dropdown unconditionally. Safari
doesn't exist on Windows, so picking it hands yt-dlp a browser it can't find. The list is
now built from a `COOKIE_BROWSERS` constant that drops Safari off-macOS. (The abandoned
`win-rust` branch had fixed this independently — it was lost when `master` became the
source of truth. See "Salvage from `win-rust-wip`" below.)

### 📋 Noted, not acted on: no `.gitattributes`

The repo has no `.gitattributes`, and the Windows box has `core.autocrlf=true`. Files show
as modified with an empty content diff (`src-tauri/Cargo.toml` did during this session) —
harmless in isolation, but it means the two machines disagree about line endings and a
Windows commit can flip a whole file to CRLF for no reason.

For a repo whose whole premise is one cross-platform source of truth, `* text=auto eol=lf`
is the right answer. **Deliberately not done here** — normalizing touches every file and
that is not a diff to land in the middle of a release. Do it as its own commit, on a quiet
branch, with the renormalization isolated.

### 📦 Salvage from `win-rust-wip`

Windows-only work that predates the unify and is **not on `master`**, parked at
`win-rust-wip` (`28c9d6b`) on the Windows box. Worth triaging rather than dropping:

- `src-tauri/src/sandbox.rs` — new, never committed upstream
- ffmpeg security hardening (notes in `SECURITY-FFMPEG.md`)
- Twitter/X download fixes: host detection, format fallback, stale-binary handling
- streamed file hashing (avoids loading whole files into memory)
- the Safari fix (already ported forward, above)

Nothing here is verified against current `master` — treat it as a source of candidates,
not a merge.

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
- [x] ~~**13. Verify the Windows bundle end-to-end**~~ — done. `.msi` + NSIS `-setup.exe`
      both build; `msiexec /a` extraction confirms `resources\ffmpeg.exe` and
      `resources\ffprobe.exe` are inside. Version info reads cleanly after the U+2019 fix.
- [ ] **14. Re-verify the macOS bundle after the `productName` change** — U+2019 is
      verified on Windows but unbuilt on macOS. Confirm `Hoggie’s Tool Kit.app` and the
      `.dmg` still build and launch. *Mac-side task.*
- [ ] **15. Run `release.yml` end-to-end** — every fix above was verified by hand on a
      workstation. The tag → draft-release path has still never executed on Windows.
      Push a throwaway tag and confirm both installers land as assets before tagging a
      real version.

### 🟡 Unify
- [x] ~~**4. Platform abstraction**~~ — `commands/platform.rs` (`EXE_SUFFIX`, `exe_name`,
      `make_executable`). yt-dlp, demucs, Real-ESRGAN and ffmpeg all cfg'd per OS.
      demucs also needed cfg'd *extraction* (macOS `.tar.gz` vs Windows `.zip`).
      ✅ **Verified by the windows-latest CI job** — clippy `-D warnings` + tests pass.
      (Can't be cross-checked from macOS: `tauri-winres` needs `llvm-rc`.)
- [x] ~~**5. Merge to `master`**~~ — clean fast-forward; `mac-rust` was a strict superset
      (64 ahead, 0 behind). Verified `master` passes lint + clippy + tests.
      Still to do: delete the stale `win-rust` / `mac-dev` / `win-dev` remote branches.
- [x] ~~**6. CI matrix**~~ — `.github/workflows/ci.yml` (lint + clippy `-D warnings` +
      tests on macOS **and** Windows, every push/PR) and `release.yml` (tag push → draft
      release with the universal `.dmg` and the `.msi`).

### 🟢 Polish
- [x] ~~**7. Cleanup**~~ — 7 dead assets deleted (348 KB); `.claude/` and
      `src-tauri/gen/schemas/` untracked + ignored. Working tree is clean.
- [x] ~~**8. SHA-256 pin for Real-ESRGAN**~~ — done, both platforms
- [~] **9. Rust unit tests** — started (7 tests). Still want: ICO building,
      progress parsing, command↔bridge parity smoke test
- [ ] **11. Three latent React bugs in `HtkWidget.jsx`** (~line 534-537), surfaced when a
      lockfile regen briefly pulled a newer `eslint-plugin-react-hooks`:
      a value from `useState()` is mutated directly, and `setState` is called
      synchronously inside an effect (cascading renders). Invisible with the currently
      pinned plugin, real regardless. Fix before bumping that plugin.
- [ ] **12. Revisit `npm ci`** — CI uses `npm install` because the local npm (11.6.2)
      and the runners' npm disagree about optional `@emnapi` packages in the lock file.
      **New evidence from the Windows box:** it runs npm **10.9.2**, and its
      `npm install` *re-added* the `@emnapi/core` + `@emnapi/runtime` entries that the
      Mac's 11.6.2 strips. `npm ci` then succeeded locally against that lock. Since the
      runners are on Node 20 (npm 10.x), the Windows-generated lock is likely the one
      they want, and npm 11 is the outlier. That regenerated lock is committed here.
      Worth trying `npm ci` in CI again — but expect it to flip back the next time the
      Mac runs `npm install`, so pin an npm version in both places before relying on it.

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
