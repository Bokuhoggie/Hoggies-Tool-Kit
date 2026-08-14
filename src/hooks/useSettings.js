/**
 * useSettings — shared settings hook backed by the Tauri bridge (`window.htk.settings`).
 *
 * Module-level cache means only one IPC read call ever happens per session,
 * regardless of how many components call useSettings(). All subscribers
 * re-render together whenever a setting is updated.
 */

import { useState, useEffect, useCallback } from 'react'

const api = window.htk

let _cache = null
const _listeners = new Set()

function broadcast(settings) {
  _listeners.forEach(fn => fn(settings))
}

function setNested(obj, dotPath, value) {
  const keys = dotPath.split('.')
  const result = JSON.parse(JSON.stringify(obj))
  let cur = result
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object') cur[keys[i]] = {}
    cur = cur[keys[i]]
  }
  cur[keys[keys.length - 1]] = value
  return result
}

export function useSettings() {
  const [settings, setSettings] = useState(_cache)

  useEffect(() => {
    _listeners.add(setSettings)
    if (!_cache) {
      api.settings.read().then(s => {
        _cache = s
        broadcast(s)
      })
    }
    return () => { _listeners.delete(setSettings) }
  }, [])

  // update('video.audioCodec', 'aac') — dot-notation path, saves immediately
  const update = useCallback(async (dotPath, value) => {
    const next = setNested(_cache || {}, dotPath, value)
    _cache = next
    broadcast(next)
    await api.settings.write(next)
  }, [])

  return { settings, update }
}
