/**
 * dropHelpers — utilities for drag-and-drop file handling.
 *
 * Under Tauri the paths arrive on the event itself, put there by tauriDrop.js. The
 * remaining branches below are fallbacks for drops that carry a path some other way,
 * such as a file URI dragged out of another application.
 */

/**
 * Extract file paths from a drop event.
 */
export function getDropPaths(e) {
  // Tauri route. A webview File object has no .path — the OS-level paths only ever
  // reach us through Tauri's own drag-drop event, which tauriDrop.js attaches here.
  const native = e?.nativeEvent || e
  if (Array.isArray(native?.htkPaths) && native.htkPaths.length) {
    return [...new Set(native.htkPaths)]
  }

  let paths = Array.from(e.dataTransfer?.files || [])
    .map(f => f.path || '')
    .filter(Boolean)

  // Fallback: If no files were parsed (e.g. dragged from a web browser or Antigravity),
  // they might be represented as text/uri-list (links to local files).
  if (paths.length === 0 && e.dataTransfer) {
    const uriStr = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || ''
    const lines = uriStr.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    for (const line of lines) {
      if (line.startsWith('file:///')) {
        try {
          const decoded = decodeURIComponent(line.substring(8)) // Remove file:///
          // Handle Windows paths vs Unix paths
          const isWindows = /^[A-Z]:\//i.test(decoded) || /^[A-Z]:\\/i.test(decoded)
          paths.push(isWindows ? decoded : '/' + decoded)
        } catch { /* malformed file URI — skip */ }
      } else if (/^[A-Z]:\\[^/:*?"<>|]+$/i.test(line) || line.startsWith('/')) {
        // Plain absolute path from text
        paths.push(line)
      }
    }
  }

  // Deduplicate
  return [...new Set(paths)]
}

/**
 * Extract the first file path from a drop event.
 * Returns the path string or '' if none.
 */
export function getFirstDropPath(e) {
  const paths = getDropPaths(e)
  return paths.length > 0 ? paths[0] : ''
}
