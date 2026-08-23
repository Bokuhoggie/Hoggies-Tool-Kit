//! Platform differences, collected in one place.
//!
//! HTK builds from a single source tree for both macOS and Windows. The real differences
//! are small — executable suffixes, per-OS download URLs and their checksums, and the
//! Unix-only chmod — so they live behind `#[cfg]` rather than in separate branches.
//! Keep the constants grouped like this rather than scattering `cfg` blocks through
//! logic; see CLAUDE.md → "Platform-specific code".

use std::path::Path;

// HTK targets macOS and Windows only. The per-OS engine constants
// (`YT_DLP_URL`, `RELEASE_URL`, `RELEASE_SHA256`, `ARCHIVE_NAME`) are defined behind
// `cfg(target_os = "macos")` / `cfg(target_os = "windows")` and have no fallback, so any
// other target fails deep in three unrelated modules with "cannot find value" — which
// reads like a missing import rather than an unsupported platform. Fail here instead,
// once, with the actual reason. Adding a platform means giving each of those constants a
// value for it, not deleting this check.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
compile_error!(
    "Hoggie's Tool Kit supports macOS and Windows only. Adding a target means supplying \
     the per-OS engine constants in download_commands.rs, stems_commands.rs, and \
     upscale_commands.rs — see CLAUDE.md → \"Platform-specific code\"."
);

/// Suffix for executables on this platform (`.exe` on Windows, empty elsewhere).
#[cfg(target_os = "windows")]
pub const EXE_SUFFIX: &str = ".exe";
#[cfg(not(target_os = "windows"))]
pub const EXE_SUFFIX: &str = "";

/// Append the platform's executable suffix to a bare binary name.
///
/// ```ignore
/// exe_name("ffmpeg") // "ffmpeg" on macOS, "ffmpeg.exe" on Windows
/// ```
pub fn exe_name(base: &str) -> String {
    format!("{}{}", base, EXE_SUFFIX)
}

/// Mark a file executable. No-op on Windows, which has no permission bit.
///
/// Every engine we download at runtime must go through this before being spawned.
pub fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exe_name_matches_platform() {
        let name = exe_name("ffmpeg");
        if cfg!(target_os = "windows") {
            assert_eq!(name, "ffmpeg.exe");
        } else {
            assert_eq!(name, "ffmpeg");
        }
    }

    #[test]
    fn exe_name_does_not_double_suffix() {
        // Callers pass bare names; the suffix is applied exactly once.
        assert_eq!(exe_name("yt-dlp"), format!("yt-dlp{}", EXE_SUFFIX));
    }
}
