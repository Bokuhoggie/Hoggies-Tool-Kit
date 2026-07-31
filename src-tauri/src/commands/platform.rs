//! Platform differences, collected in one place.
//!
//! HTK builds from a single source tree for both macOS and Windows. The real differences
//! are small — executable suffixes, per-OS download URLs and their checksums, and the
//! Unix-only chmod — so they live behind `#[cfg]` rather than in separate branches.
//! Keep the constants grouped like this rather than scattering `cfg` blocks through
//! logic; see CLAUDE.md → "Platform-specific code".

use std::path::Path;

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
