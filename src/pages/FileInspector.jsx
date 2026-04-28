import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconInspect } from '../components/Icons.jsx'
import { consumePendingFile } from '../globalDrop.js'
import { getFirstDropPath } from '../dropHelpers.js'
import WaveformPlayer from '../components/WaveformPlayer.jsx'

const api = window.htk

// Category → accent colour
const CATEGORY_ACCENT = {
  image: 'var(--accent-3)',
  audio: 'var(--accent-2)',
  video: 'var(--accent)',
  pdf:   'var(--accent-4)',
}

// Human-readable category badge
const CATEGORY_LABEL = {
  image: 'IMAGE',
  audio: 'AUDIO',
  video: 'VIDEO',
  pdf:   'PDF',
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
    </div>
  )
}

export default function FileInspector() {
  const [info, setInfo]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [hash, setHash]         = useState(null)
  const [hashing, setHashing]   = useState(false)
  const navigate = useNavigate()
  const analyzeIdRef = useRef(0)

  const [error, setError] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const [imagePreview, setImagePreview] = useState(null)

  const analyze = useCallback(async (filePath) => {
    if (!filePath) return
    const id = ++analyzeIdRef.current
    setLoading(true); setInfo(null); setHash(null); setError(null); setShowPreview(false); setImagePreview(null)
    try {
      const result = await api.inspector.analyze(filePath)
      if (id !== analyzeIdRef.current) return // stale — a newer analyze() was called
      if (result?.error) setError(result.error)
      else {
        setInfo(result)
        // Auto-show preview for media files
        if (result.category === 'audio' || result.category === 'video') {
          setShowPreview(true)
        }
        // Load image preview
        if (result.category === 'image') {
          api.image.readAsDataURL(filePath).then(url => {
            if (id !== analyzeIdRef.current) return
            if (url) setImagePreview(url)
          }).catch(() => {})
        }
      }
    } catch (err) {
      if (id !== analyzeIdRef.current) return
      setError(err?.message || 'Failed to analyze file')
    }
    if (id === analyzeIdRef.current) setLoading(false)
  }, [])

  // Subscribe to global drops while mounted. Pre-mount drops are consumed via
  // a deferred call so the setState happens outside the effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    const handler = () => {
      const f = consumePendingFile()
      if (f) analyze(f)
    }
    window.addEventListener('global-file-drop', handler)
    queueMicrotask(handler)
    return () => window.removeEventListener('global-file-drop', handler)
  }, [analyze])

  const browse = async () => {
    const f = await api.inspector.selectFile()
    if (f) analyze(f)
  }

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const path = getFirstDropPath(e)
    if (path) {
      analyze(path) // Keep analyze to process the file
      window.dispatchEvent(new CustomEvent('blade-flick', { detail: '/inspector' }))
    }
  }

  const computeHash = async () => {
    if (!info?.path) return
    setHashing(true)
    try {
      const res = await api.hash.compute({ filePath: info.path, algorithms: ['sha256', 'md5'] })
      setHash(res?.hashes || null)
    } catch {
      setHash(null)
    }
    setHashing(false)
  }

  const openInTool = () => {
    if (!info?.suggestedTool) return
    navigate(info.suggestedTool, { state: { file: info.path } })
  }

  const accent = (info?.category && CATEGORY_ACCENT[info.category]) || 'var(--accent)'

  return (
    <div className="page-anim" style={{ '--accent': accent }}>
      <div className="page-header">
        <h1 className="page-title">
          <IconInspect size={20} />
          File Inspector
        </h1>
        <p className="page-subtitle">Drop any file to instantly analyze its format, metadata, and properties</p>
      </div>

      {/* Drop zone — shown when no file loaded */}
      {!info && !loading && (
        <div
          className={`card inspector-drop${dragOver ? ' drag-over-inspector' : ''}`}
          onClick={browse}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
          onDrop={handleDrop}
          style={{ cursor: 'pointer', textAlign: 'center', padding: '60px 24px' }}
        >
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>🔍</div>
          <div className="dropzone-title">Drop any file here, or click to browse</div>
          <div className="dropzone-sub" style={{ marginTop: 8 }}>
            Images · Audio · Video · PDFs · Archives · Code · Executables — anything
          </div>
          <div className="dropzone-sub" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
            Or drop a file anywhere in the app to send it here automatically
          </div>
        </div>
      )}

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <span className="spinner" style={{ fontSize: 28 }}>⟳</span>
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 7, marginTop: 16, color: 'var(--text-secondary)' }}>
            SCANNING…
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="card" style={{ padding: '24px' }}>
          <div className="result-banner error">Failed to inspect file: {error}</div>
          <button className="btn btn-secondary" onClick={browse} style={{ marginTop: 12 }}>Try Another File</button>
        </div>
      )}

      {info && !loading && (
        <>
          {/* ── File header ── */}
          <div className="card inspector-header" style={{ marginBottom: 12 }}>
            <div className="inspector-file-row">
              <div className="inspector-file-icon" style={{ color: accent }}>
                {info.category === 'image' ? '🖼' :
                 info.category === 'audio' ? '🎵' :
                 info.category === 'video' ? '🎬' :
                 info.category === 'pdf'   ? '📄' : '📁'}
              </div>
              <div className="inspector-file-info">
                <div className="inspector-file-name">{info.name}</div>
                <div className="inspector-file-path">{info.path}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
                {info.category && (
                  <span className="inspector-badge" style={{ '--badge-color': accent }}>
                    {CATEGORY_LABEL[info.category]}
                  </span>
                )}
                {info.suggestedTool && (
                  <button
                    className="btn btn-primary inspector-send-btn"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('blade-peek', { detail: null }))
                      window.dispatchEvent(new CustomEvent('blade-flick', { detail: info.suggestedTool }))
                      openInTool()
                    }}
                    onMouseEnter={() => window.dispatchEvent(new CustomEvent('blade-peek', { detail: info.suggestedTool }))}
                    onMouseLeave={() => window.dispatchEvent(new CustomEvent('blade-peek', { detail: null }))}
                  >
                    Open in {info.suggestedToolLabel} ↗
                  </button>
                )}
                {info.category === 'audio' && (
                  <button
                    className="btn btn-secondary inspector-send-btn"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('blade-peek', { detail: null }))
                      window.dispatchEvent(new CustomEvent('blade-flick', { detail: '/stems' }))
                      navigate('/stems', { state: { file: info.path } })
                    }}
                    onMouseEnter={() => window.dispatchEvent(new CustomEvent('blade-peek', { detail: '/stems' }))}
                    onMouseLeave={() => window.dispatchEvent(new CustomEvent('blade-peek', { detail: null }))}
                  >
                    Split Stems ↗
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Base stats ── */}
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Size"      value={info.sizeStr} />
            <StatCard label="Extension" value={`.${info.ext}`} />
            <StatCard label="MIME Type" value={info.mime} />
            <StatCard label="Modified"  value={info.modified} />
            <StatCard label="Created"   value={info.created} />
          </div>

          {/* ── Type-specific details ── */}
          {info.details && Object.keys(info.details).length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="inspector-section-title" style={{ color: accent }}>
                // {info.category?.toUpperCase()} PROPERTIES
              </div>
              <div className="stat-grid">
                {Object.entries(info.details).map(([k, v]) => (
                  <StatCard key={k} label={k} value={String(v)} />
                ))}
              </div>
            </div>
          )}

          {/* ── Image Preview ── */}
          {info.category === 'image' && imagePreview && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="inspector-section-title" style={{ color: accent }}>
                // PREVIEW
              </div>
              <div className="inspector-image-preview">
                <img src={imagePreview} alt={info.name} />
              </div>
            </div>
          )}

          {/* ── Media Preview ── */}
          {(info.category === 'video' || info.category === 'audio') && (
            <div className="card" style={{ marginBottom: 12, overflow: 'visible' }}>
              <div className="inspector-section-title" style={{ color: accent }}>
                // PREVIEW
              </div>
              {!showPreview ? (
                <button className="btn btn-secondary" onClick={() => setShowPreview(true)}>
                  {info.category === 'video' ? '🎬' : '🎵'} Play {info.category === 'video' ? 'Video' : 'Audio'}
                </button>
              ) : (
                <div className="media-preview" style={{ marginTop: 8 }}>
                  <WaveformPlayer
                    filePath={info.path}
                    type={info.category}
                    accentColor="var(--text-primary)"
                    label={info.name}
                    onClose={() => setShowPreview(false)}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── PDF Preview ── */}
          {info.category === 'pdf' && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="inspector-section-title" style={{ color: accent }}>
                // PREVIEW
              </div>
              <div style={{
                border: '1px solid var(--border)',
                borderRadius: 4,
                overflow: 'hidden',
                background: '#fff',
              }}>
                <embed
                  src={`sk-media://file?path=${encodeURIComponent(info.path)}`}
                  type="application/pdf"
                  style={{ width: '100%', height: 500, display: 'block' }}
                />
              </div>
            </div>
          )}

          {/* ── Hash ── */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="inspector-section-title" style={{ color: 'var(--text-muted)' }}>
              // CHECKSUMS
            </div>
            {!hash && (
              <button className="btn btn-secondary" onClick={computeHash} disabled={hashing}>
                {hashing ? <span className="spinner">⟳</span> : '🔑'}
                {hashing ? 'Computing…' : 'Compute Hashes (SHA-256 + MD5)'}
              </button>
            )}
            {hash && (
              <div className="hash-results">
                {Object.entries(hash).map(([algo, val]) => (
                  <div key={algo} className="hash-row">
                    <span className="hash-algo-label">{algo.toUpperCase()}</span>
                    <span className="hash-val">{val}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Scan another ── */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={browse}>📂 Inspect Another File</button>
            <button className="btn btn-ghost" onClick={() => { setInfo(null); setHash(null) }}>✕ Clear</button>
          </div>
        </>
      )}
    </div>
  )
}
