import { useState, useEffect, useRef, useCallback } from 'react'

const api = window.htk

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

// A <video> that fails to load does so silently — it just renders an empty black box,
// which is indistinguishable from "the app is broken". Turn the MediaError into
// something that says which half went wrong: reaching the file, or decoding it.
function describeMediaError(el) {
  const err = el?.error
  // Also log it: in `tauri dev` the webview's console is piped into the terminal, so a
  // failed preview leaves a record with the codes intact rather than only a UI banner.
  console.error('[preview] media failed', {
    code: err?.code,
    message: err?.message,
    src: el?.currentSrc || el?.src,
    networkState: el?.networkState,
    readyState: el?.readyState,
  })
  switch (err?.code) {
    case 1: return 'Playback was aborted.'
    case 2: return 'Could not read the file — the app could not fetch it from disk.'
    case 3: return 'The file was read, but its video codec cannot be decoded by the built-in player.'
    case 4: return 'This container or codec is not supported by the built-in player.'
    default: return err?.message || 'The file could not be played.'
  }
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── SVG Icons ─────────────────────────────────────────────────────────
const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <path d="M5 3.5L16.5 10L5 16.5V3.5Z" />
  </svg>
)
const PauseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <rect x="4" y="3" width="4" height="14" rx="1" />
    <rect x="12" y="3" width="4" height="14" rx="1" />
  </svg>
)
const SkipBackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M12.5 2.5L6 8L12.5 13.5V2.5Z" />
    <rect x="3" y="3" width="2" height="10" rx="0.5" />
  </svg>
)
const SkipFwdIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M3.5 2.5L10 8L3.5 13.5V2.5Z" />
    <rect x="11" y="3" width="2" height="10" rx="0.5" />
  </svg>
)
const VolumeIcon = ({ level }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 6h2.5l3-3v10l-3-3H2a1 1 0 01-1-1V7a1 1 0 011-1z" />
    {level > 0 && <path d="M10 5.5c.8.8 1.2 1.9 1.2 3s-.4 2.2-1.2 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    {level > 0.5 && <path d="M12 3.5c1.3 1.3 2 3 2 4.5s-.7 3.2-2 4.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
  </svg>
)
const RazorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M9.5 1L3 12h3l1.5 3L14 4h-3L9.5 1zM7.2 10.5L9.5 4.2l1.8 0L8.5 10.5H7.2z" />
  </svg>
)

export default function WaveformPlayer({
  filePath,
  type = 'audio',
  accentColor = 'var(--text-primary)',
  onClose,
  label = '',
  showClip = true,
}) {
  const [peaks, setPeaks]             = useState([])
  const [waveLoading, setWaveLoading] = useState(true)
  const [playing, setPlaying]         = useState(false)
  const [mediaError, setMediaError]   = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]       = useState(0)
  const [clipStart, setClipStart]     = useState(null)
  const [clipEnd, setClipEnd]         = useState(null)
  const [clipping, setClipping]       = useState(false)
  const [clipResult, setClipResult]   = useState(null)
  const [volume, setVolume]           = useState(1)
  const [speed, setSpeed]             = useState(1)
  const [hoverTime, setHoverTime]     = useState(null)
  const [hoverX, setHoverX]           = useState(0)
  const [razorMode, setRazorMode]     = useState(false)

  const mediaRef       = useRef(null)
  const waveformRef    = useRef(null)
  const playheadRef    = useRef(null)
  const hoverLineRef   = useRef(null)
  const timeDisplayRef = useRef(null)
  const rafRef         = useRef(null)
  const isDragging     = useRef(false)
  const dragTarget     = useRef(null) // 'seek' | 'clipStart' | 'clipEnd'
  const lastStateUpdate = useRef(0)
  const playerRef      = useRef(null)
  const clipStartRef   = useRef(null)
  const clipEndRef     = useRef(null)

  // ── Cleanup on unmount ──────────────────────────────────────────────
  useEffect(() => {
    const el = mediaRef.current
    const raf = rafRef
    return () => {
      if (el) { el.pause(); el.src = '' }
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [])

  // ── Reset state when filePath changes (render-time, not in an effect) ──
  const [lastFilePath, setLastFilePath] = useState(filePath)
  if (filePath !== lastFilePath) {
    setLastFilePath(filePath)
    setPeaks([])
    setCurrentTime(0)
    setDuration(0)
    setPlaying(false)
    setClipStart(null)
    setClipEnd(null)
    setClipResult(null)
    setHoverTime(null)
    setRazorMode(false)
    setMediaError(null)
    setWaveLoading(!!filePath)
  }

  // ── Async load (setState only happens in .then, not the effect body) ──
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    api.media.waveform(filePath).then((data) => {
      if (cancelled) return
      setPeaks(data || [])
      setWaveLoading(false)
    }).catch(() => { if (!cancelled) setWaveLoading(false) })
    return () => { cancelled = true }
  }, [filePath])

  // ── RAF playhead loop (60fps DOM-only, throttled React state) ───────
  useEffect(() => {
    const tick = () => {
      const el = mediaRef.current
      if (el) {
        if (el.duration && !isNaN(el.duration) && el.duration !== Infinity) {
          const pct = el.currentTime / el.duration

          // GPU-accelerated playhead position
          if (playheadRef.current && !isDragging.current) {
            const containerWidth = waveformRef.current?.offsetWidth || 0
            playheadRef.current.style.transform = `translateX(${pct * containerWidth}px)`
          }

          // Direct DOM time display update (no React re-render)
          if (timeDisplayRef.current) {
            timeDisplayRef.current.textContent = `${formatTime(el.currentTime)} / ${formatTime(el.duration)}`
          }

          // Throttled React state update (~4Hz) for clip labels etc.
          const now = performance.now()
          if (now - lastStateUpdate.current > 250) {
            lastStateUpdate.current = now
            setCurrentTime(el.currentTime)
            if (el.duration !== duration) setDuration(el.duration)
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [filePath, duration])

  // ── Keep clip handle DOM positions synced ───────────────────────────
  useEffect(() => {
    const rect = waveformRef.current
    if (!rect) return
    const w = rect.offsetWidth
    if (clipStartRef.current && clipStart !== null && duration > 0) {
      clipStartRef.current.style.left = `${(clipStart / duration) * w}px`
    }
    if (clipEndRef.current && clipEnd !== null && duration > 0) {
      clipEndRef.current.style.left = `${(clipEnd / duration) * w}px`
    }
  }, [clipStart, clipEnd, duration, peaks])

  // ── Play / pause ────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    if (el.paused) {
      // play() rejects on an unplayable source. Without this the button flips to
      // "pause" and nothing happens, which reads as the control being dead.
      const started = el.play()
      if (started?.catch) {
        started.catch(() => { setPlaying(false); setMediaError(describeMediaError(el)) })
      }
      setPlaying(true)
    } else {
      el.pause(); setPlaying(false)
    }
  }, [])

  const handleEnded = useCallback(() => setPlaying(false), [])

  // ── Skip forward / backward ─────────────────────────────────────────
  const skip = useCallback((delta) => {
    const el = mediaRef.current
    if (!el || !el.duration) return
    el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + delta))
    setCurrentTime(el.currentTime)
  }, [])

  // ── Volume ──────────────────────────────────────────────────────────
  const handleVolume = useCallback((v) => {
    setVolume(v)
    if (mediaRef.current) mediaRef.current.volume = v
  }, [])

  // ── Speed ───────────────────────────────────────────────────────────
  const cycleSpeed = useCallback(() => {
    setSpeed(prev => {
      const idx = SPEEDS.indexOf(prev)
      const next = SPEEDS[(idx + 1) % SPEEDS.length]
      if (mediaRef.current) mediaRef.current.playbackRate = next
      return next
    })
  }, [])

  // ── Seek helpers ────────────────────────────────────────────────────
  const pctFromClientX = useCallback((clientX) => {
    const rect = waveformRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const seekToPosition = useCallback((clientX) => {
    const el = mediaRef.current
    if (!el) return
    const dur = el.duration && !isNaN(el.duration) ? el.duration : 0
    if (!dur) return
    const pct = pctFromClientX(clientX)
    el.currentTime = pct * dur
    setCurrentTime(pct * dur)
    if (playheadRef.current) {
      const containerWidth = waveformRef.current?.offsetWidth || 0
      playheadRef.current.style.transform = `translateX(${pct * containerWidth}px)`
    }
  }, [pctFromClientX])

  // ── Mouse interactions on waveform ──────────────────────────────────
  const handleWaveformMouseDown = useCallback((e) => {
    e.preventDefault()
    const el = mediaRef.current
    const dur = el?.duration && !isNaN(el.duration) ? el.duration : 0
    if (!dur) return

    // Razor mode: click sets clip start, second click sets clip end
    if (razorMode) {
      const pct = pctFromClientX(e.clientX)
      const time = pct * dur
      if (clipStart === null || (clipStart !== null && clipEnd !== null)) {
        // First cut or reset: set start
        setClipStart(time)
        setClipEnd(null)
        setClipResult(null)
      } else {
        // Second cut: set end (ensure end > start)
        if (time > clipStart) {
          setClipEnd(time)
        } else {
          setClipEnd(clipStart)
          setClipStart(time)
        }
        setRazorMode(false) // Auto-exit razor mode after selecting region
      }
      return
    }

    // Normal mode: seek by dragging
    isDragging.current = true
    dragTarget.current = 'seek'
    seekToPosition(e.clientX)

    const handleMouseMove = (ev) => {
      if (dragTarget.current === 'seek') seekToPosition(ev.clientX)
    }
    const handleMouseUp = () => {
      isDragging.current = false
      dragTarget.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [seekToPosition, pctFromClientX, razorMode, clipStart, clipEnd])

  // ── Drag clip handles ───────────────────────────────────────────────
  const startClipDrag = useCallback((which, e) => {
    e.stopPropagation()
    e.preventDefault()
    isDragging.current = true
    dragTarget.current = which

    const handleMouseMove = (ev) => {
      const el = mediaRef.current
      if (!el?.duration) return
      const pct = pctFromClientX(ev.clientX)
      const time = pct * el.duration
      const containerWidth = waveformRef.current?.offsetWidth || 0

      if (which === 'clipStart') {
        const bounded = clipEnd !== null ? Math.min(time, clipEnd - 0.1) : time
        setClipStart(Math.max(0, bounded))
        setClipResult(null)
        if (clipStartRef.current) {
          clipStartRef.current.style.left = `${pctFromClientX(ev.clientX) * containerWidth}px`
        }
      } else {
        const bounded = clipStart !== null ? Math.max(time, clipStart + 0.1) : time
        setClipEnd(Math.min(el.duration, bounded))
        setClipResult(null)
        if (clipEndRef.current) {
          clipEndRef.current.style.left = `${pctFromClientX(ev.clientX) * containerWidth}px`
        }
      }
    }
    const handleMouseUp = () => {
      isDragging.current = false
      dragTarget.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [pctFromClientX, clipStart, clipEnd])

  // ── Touch drag scrubbing ────────────────────────────────────────────
  const handleTouchStart = useCallback((e) => {
    isDragging.current = true
    dragTarget.current = 'seek'
    seekToPosition(e.touches[0].clientX)

    const handleTouchMove = (ev) => { ev.preventDefault(); seekToPosition(ev.touches[0].clientX) }
    const handleTouchEnd = () => {
      isDragging.current = false
      dragTarget.current = null
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
  }, [seekToPosition])

  // ── Hover preview line ──────────────────────────────────────────────
  const handleWaveformMouseMove = useCallback((e) => {
    if (isDragging.current) return
    const rect = waveformRef.current?.getBoundingClientRect()
    if (!rect) return
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const x = pct * rect.width
    setHoverX(x)
    if (hoverLineRef.current) {
      hoverLineRef.current.style.transform = `translateX(${x}px)`
      hoverLineRef.current.style.opacity = '1'
    }
    const el = mediaRef.current
    if (el?.duration) setHoverTime(pct * el.duration)
  }, [])

  const handleWaveformMouseLeave = useCallback(() => {
    if (hoverLineRef.current) hoverLineRef.current.style.opacity = '0'
    setHoverTime(null)
  }, [])

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return
      if (!playerRef.current) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          skip(-5)
          break
        case 'ArrowRight':
          e.preventDefault()
          skip(5)
          break
        case 'ArrowUp':
          e.preventDefault()
          handleVolume(Math.min(1, volume + 0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          handleVolume(Math.max(0, volume - 0.1))
          break
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [togglePlay, skip, handleVolume, volume])

  // ── Clip ────────────────────────────────────────────────────────────
  const handleClip = async () => {
    if (clipStart === null || clipEnd === null || clipStart >= clipEnd) return
    const outputDir = await api.selectOutputDir()
    if (!outputDir) return
    setClipping(true); setClipResult(null)
    try {
      const res = await api.media.clip({ filePath, startTime: clipStart, endTime: clipEnd, outputDir })
      setClipResult(res)
    } catch (err) {
      setClipResult({ success: false, error: err?.message || 'Clip failed' })
    }
    setClipping(false)
  }

  const clearClip = () => {
    setClipStart(null)
    setClipEnd(null)
    setClipResult(null)
    setRazorMode(false)
  }

  // ── Derived ─────────────────────────────────────────────────────────
  const playPct      = duration > 0 ? currentTime / duration : 0
  const clipStartPct = clipStart !== null && duration > 0 ? clipStart / duration : null
  const clipEndPct   = clipEnd   !== null && duration > 0 ? clipEnd   / duration : null

  const mediaUrl = api.media.fileUrl(filePath)

  return (
    <div
      className="waveform-player"
      style={{ '--wf-accent': accentColor }}
      ref={playerRef}
    >

      {/* ── Waveform ── */}
      <div className="waveform-crown">
        <div
          className={`waveform-container${razorMode ? ' waveform-razor-active' : ''}`}
          ref={waveformRef}
          onMouseDown={handleWaveformMouseDown}
          onTouchStart={handleTouchStart}
          onMouseMove={handleWaveformMouseMove}
          onMouseLeave={handleWaveformMouseLeave}
        >
          {waveLoading ? (
            <div className="waveform-loading">
              <span className="spinner" style={{ fontSize: 12 }}>⟳</span>
              <span>Analysing waveform…</span>
            </div>
          ) : (
            <div className="waveform-bars">
              {peaks.map((peak, i) => {
                const pct = i / peaks.length
                const played = pct <= playPct
                const inClip =
                  clipStartPct !== null &&
                  clipEndPct !== null &&
                  pct >= clipStartPct &&
                  pct <= clipEndPct
                return (
                  <div
                    key={i}
                    className="waveform-bar"
                    style={{
                      height: `${Math.max(12, peak * 100)}%`,
                      backgroundColor: inClip
                        ? 'var(--accent-3, #3b82f6)'
                        : played
                          ? 'var(--wf-accent)'
                          : 'var(--text-secondary)',
                      opacity: played || inClip ? 1 : 0.5,
                    }}
                  />
                )
              })}
            </div>
          )}

          {/* Hover preview line */}
          <div ref={hoverLineRef} className="waveform-hover-line" style={{ opacity: 0 }} />

          {/* Hover time tooltip */}
          {hoverTime !== null && (
            <div className="waveform-hover-tooltip" style={{ left: `${hoverX}px` }}>
              {formatTime(hoverTime)}
            </div>
          )}

          {/* Playhead line */}
          <div ref={playheadRef} className="waveform-playhead" />

          {/* Clip region overlay + draggable handles */}
          {clipStartPct !== null && clipEndPct !== null && (
            <div
              className="waveform-clip-region"
              style={{
                left: `${clipStartPct * 100}%`,
                width: `${(clipEndPct - clipStartPct) * 100}%`,
              }}
            />
          )}

          {/* Left clip handle */}
          {clipStart !== null && duration > 0 && (
            <div
              ref={clipStartRef}
              className="waveform-clip-handle waveform-clip-handle-left"
              style={{ left: `${(clipStart / duration) * 100}%` }}
              onMouseDown={(e) => startClipDrag('clipStart', e)}
              title={`Clip start: ${formatTime(clipStart)}`}
            >
              <div className="waveform-clip-handle-bar" />
              <div className="waveform-clip-handle-label">{formatTime(clipStart)}</div>
            </div>
          )}

          {/* Right clip handle */}
          {clipEnd !== null && duration > 0 && (
            <div
              ref={clipEndRef}
              className="waveform-clip-handle waveform-clip-handle-right"
              style={{ left: `${(clipEnd / duration) * 100}%` }}
              onMouseDown={(e) => startClipDrag('clipEnd', e)}
              title={`Clip end: ${formatTime(clipEnd)}`}
            >
              <div className="waveform-clip-handle-bar" />
              <div className="waveform-clip-handle-label">{formatTime(clipEnd)}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Header ── */}
      <div className="media-preview-header">
        <span className="form-label">{label || (type === 'video' ? 'Video Preview' : 'Audio Preview')}</span>
        {onClose && <button className="btn btn-ghost btn-sm" onClick={onClose}>✕ Close</button>}
      </div>

      {/* ── Media element — always use <video> ── */}
      <div className="media-preview-video-wrap" style={type === 'audio' ? { height: 0, overflow: 'hidden' } : undefined}>
        <video
          ref={mediaRef}
          key={filePath}
          src={mediaUrl}
          controls={type === 'video'}
          preload="auto"
          className="media-preview-player"
          onEnded={handleEnded}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={(e) => { setPlaying(false); setMediaError(describeMediaError(e.target)) }}
          onLoadedMetadata={(e) => {
            setMediaError(null)
            setDuration(e.target.duration)
            e.target.volume = volume
            e.target.playbackRate = speed
          }}
        />
        {mediaError && (
          <div className="media-preview-error">
            <div>✗ {mediaError}</div>
            <div className="media-preview-error-path" title={mediaUrl}>{mediaUrl}</div>
          </div>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="waveform-controls">
        {/* Transport: skip back, play, skip forward */}
        <div className="waveform-transport">
          <button className="waveform-skip-btn" onClick={() => skip(-10)} title="Back 10s">
            <SkipBackIcon />
          </button>
          <button className="waveform-play-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="waveform-skip-btn" onClick={() => skip(10)} title="Forward 10s">
            <SkipFwdIcon />
          </button>
        </div>

        {/* Time display — direct DOM updates via ref */}
        <span className="waveform-time" ref={timeDisplayRef}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div style={{ flex: 1 }} />

        {/* Volume */}
        <div className="waveform-volume">
          <button className="waveform-volume-icon" onClick={() => handleVolume(volume > 0 ? 0 : 1)} title={volume > 0 ? 'Mute' : 'Unmute'}>
            <VolumeIcon level={volume} />
          </button>
          <input
            type="range"
            className="waveform-volume-slider"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={e => handleVolume(parseFloat(e.target.value))}
            title={`Volume: ${Math.round(volume * 100)}%`}
          />
        </div>

        {/* Speed */}
        <button className="waveform-speed-btn" onClick={cycleSpeed} title="Playback speed">
          {speed}x
        </button>

        {/* Clip tools */}
        {showClip && duration > 0 && (
          <div className="waveform-clip-controls">
            {/* Razor tool */}
            <button
              className={`waveform-clip-tool-btn${razorMode ? ' active' : ''}`}
              onClick={() => setRazorMode(!razorMode)}
              title="Razor tool — click waveform to set clip start & end"
            >
              <RazorIcon /> Razor
            </button>

            {/* Manual set at playhead */}
            <button
              className="waveform-clip-tool-btn"
              onClick={() => { setClipStart(currentTime); setClipResult(null) }}
              title="Set clip start at playhead"
            >
              Set [
            </button>
            <button
              className="waveform-clip-tool-btn"
              onClick={() => { setClipEnd(currentTime); setClipResult(null) }}
              title="Set clip end at playhead"
            >
              Set ]
            </button>

            {/* Clear */}
            {(clipStart !== null || clipEnd !== null) && (
              <button className="waveform-clip-tool-btn" onClick={clearClip} title="Clear clip region">
                ✕
              </button>
            )}

            {/* Export clip */}
            {clipStart !== null && clipEnd !== null && clipEnd > clipStart && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleClip}
                disabled={clipping}
                title="Export clip"
              >
                {clipping ? <span className="spinner">⟳</span> : '✂'}
                {' '}Clip ({formatTime(clipEnd - clipStart)})
              </button>
            )}
          </div>
        )}
      </div>

      {clipResult && (
        <div className={`result-banner ${clipResult.success ? 'success' : 'error'}`} style={{ margin: '0 12px 8px' }}>
          {clipResult.success ? `✓ Saved clip → ${clipResult.outputPath}` : `✗ ${clipResult.error}`}
        </div>
      )}

    </div>
  )
}
