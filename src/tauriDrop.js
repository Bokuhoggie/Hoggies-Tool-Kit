/**
 * tauriDrop — makes drag-and-drop work under Tauri.
 *
 * Two things break dropping a file on a Tauri webview, and both have to be handled:
 *
 * 1. Tauri intercepts native file drops before the webview sees them — `dragDropEnabled`
 *    defaults to true — so the DOM never fires `dragover`/`drop` at all. Every
 *    `onDrop` handler in the app is unreachable. Tauri emits its own event instead.
 * 2. Even with the DOM event, a webview `File` object has no `.path`. Only Tauri's
 *    event carries absolute paths, which is what ffmpeg and the Rust commands need.
 *
 * Rather than rewrite nine dropzones, this translates Tauri's event back into the DOM
 * events they already listen for, and hangs the real paths off the event object for
 * `dropHelpers.getDropPaths()` to read.
 *
 * If Tauri's event never arrives — a plain browser, or `dragDropEnabled` turned off —
 * nothing here fires and the DOM's own events are left to behave normally.
 */
import { getCurrentWebview } from '@tauri-apps/api/webview'

let started = false
let lastTarget = null

/**
 * Tauri reports the cursor in physical pixels relative to the webview. elementFromPoint
 * wants CSS pixels relative to the viewport, and the webview fills the window
 * (`decorations: false`), so scaling by the device pixel ratio is the whole conversion.
 */
function elementAt(position) {
  if (!position) return null
  const dpr = window.devicePixelRatio || 1
  return document.elementFromPoint(position.x / dpr, position.y / dpr)
}

/**
 * Dispatch a real DragEvent so React's delegated listeners pick it up. It has to bubble:
 * the element under the cursor is usually a label inside the dropzone, not the dropzone
 * itself, and the handler is on the dropzone.
 */
function fire(target, type, paths) {
  if (!target) return
  const event = new DragEvent(type, { bubbles: true, cancelable: true })
  if (paths) event.htkPaths = paths
  target.dispatchEvent(event)
}

function moveTo(target) {
  if (target === lastTarget) return
  fire(lastTarget, 'dragleave')
  lastTarget = target
  fire(target, 'dragenter')
}

export function initTauriDragDrop() {
  if (started) return
  started = true

  let webview
  try {
    webview = getCurrentWebview()
  } catch {
    return // not running under Tauri
  }

  webview.onDragDropEvent(({ payload }) => {
    switch (payload.type) {
      case 'enter':
      case 'over': {
        const target = elementAt(payload.position)
        moveTo(target)
        // Dropzones call preventDefault() on dragover to mark themselves droppable, and
        // several use it to drive their hover styling.
        fire(target, 'dragover')
        break
      }
      case 'drop': {
        const target = elementAt(payload.position) || lastTarget
        if (lastTarget && lastTarget !== target) fire(lastTarget, 'dragleave')
        lastTarget = null
        fire(target, 'drop', payload.paths)
        break
      }
      case 'leave': {
        fire(lastTarget, 'dragleave')
        lastTarget = null
        break
      }
    }
  }).catch(() => { /* no webview to subscribe to — leave the DOM events alone */ })
}
