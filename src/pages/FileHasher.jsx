import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { IconHash } from '../components/Icons.jsx'
import { getFirstDropPath } from '../dropHelpers.js'

const ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512']
const ALGO_INFO = {
  md5:    { label: 'MD5',     bits: 128, note: 'Fast but not collision-resistant' },
  sha1:   { label: 'SHA-1',   bits: 160, note: 'Legacy — use SHA-256+ for security' },
  sha256: { label: 'SHA-256', bits: 256, note: 'Recommended for most use cases' },
  sha512: { label: 'SHA-512', bits: 512, note: 'Maximum security' },
}
const api = window.htk

export default function FileHasher() {
  const { state } = useLocation()
  const [file, setFile] = useState(null)
  const [fileSize, setFileSize] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(null)
  useEffect(() => { window.dispatchEvent(new CustomEvent('blade-busy', { detail: { route: '/hash', busy: loading } })) }, [loading])
  const [compareVal, setCompareVal] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [lastRouteFile, setLastRouteFile] = useState(null)

  if (state?.file && state.file !== lastRouteFile) {
    setLastRouteFile(state.file)
    setFile(state.file)
    setResult(null)
  }

  const basename = (p) => p?.split('/').pop().split('\\').pop()

  const formatSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }

  const handleDrop = async (e) => {
    e.preventDefault(); e.stopPropagation()
    setDragOver(false)
    const filePath = getFirstDropPath(e)
    if (filePath) {
      setFile(filePath)
      setResult(null)
      setCopied(null)
      setCompareVal('')
      await compute(filePath)
      window.dispatchEvent(new CustomEvent('blade-flick', { detail: '/hash' }))
    }
  }

  const handleBrowse = async () => {
    const selected = await api.hash.selectFile()
    if (selected) {
      setFile(selected)
      setResult(null)
      setCopied(null)
      setCompareVal('')
      await compute(selected)
    }
  }

  const compute = async (filePath) => {
    setLoading(true)
    try {
      const res = await api.hash.compute({ filePath, algorithms: ALGORITHMS })
      setResult(res)
      if (res.size !== undefined) setFileSize(res.size)
    } catch (err) {
      setResult({ success: false, error: err?.message || 'Hash computation failed' })
    }
    setLoading(false)
  }

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const copyAll = () => {
    if (!result?.hashes) return
    const text = ALGORITHMS.map(a => `${a.toUpperCase()}: ${result.hashes[a]}`).join('\n')
    navigator.clipboard.writeText(text)
    setCopied('all')
    setTimeout(() => setCopied(null), 2000)
  }

  const compareClean = compareVal.trim().toLowerCase()
  const matchAlgo = compareClean
    ? Object.entries(result?.hashes || {}).find(([, v]) => v === compareClean)?.[0]
    : null

  return (
    <div className="page-anim">
      <div className="page-header">
        <h1 className="page-title"><IconHash size={20} /> File Hasher</h1>
        <p className="page-subtitle">Generate & verify file fingerprints — MD5, SHA-1, SHA-256, SHA-512</p>
      </div>

      <div className="card">
        {/* Drop zone */}
        <div
          className={`dropzone${dragOver ? ' drag-over' : ''}`}
          onClick={handleBrowse}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
          onDrop={handleDrop}
        >
          {file ? (
            <div style={{ textAlign: 'center' }}>
              <div className="dropzone-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: 18, opacity: 0.6 }}>📄</span>
                {basename(file)}
              </div>
              {fileSize && (
                <div className="dropzone-sub" style={{ marginTop: 4 }}>{formatSize(fileSize)}</div>
              )}
              <div className="dropzone-sub" style={{ marginTop: 6, fontSize: '0.55rem', opacity: 0.4 }}>
                Drop another file or click to change
              </div>
            </div>
          ) : (
            <>
              <div className="dropzone-icon"><IconHash size={36} /></div>
              <div className="dropzone-title">Drop any file here or click to browse</div>
              <div className="dropzone-sub">Instantly compute cryptographic hashes for verification</div>
            </>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
            <span className="spinner" style={{ fontSize: 28 }}>⟳</span>
            <p style={{ marginTop: 10, fontSize: 13, fontFamily: "'Press Start 2P', monospace", letterSpacing: 1 }}>
              Computing hashes…
            </p>
          </div>
        )}

        {/* Results */}
        {result?.success && (
          <>
            {/* Hash cards */}
            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              {ALGORITHMS.map(algo => {
                const info = ALGO_INFO[algo]
                const isMatch = compareClean && result.hashes[algo] === compareClean
                const isMismatch = compareClean && !matchAlgo && result.hashes[algo] !== compareClean
                return (
                  <div
                    key={algo}
                    style={{
                      padding: '12px 16px',
                      background: isMatch ? 'rgba(57,255,20,0.08)' : 'var(--bg-elevated)',
                      border: `1px solid ${isMatch ? 'var(--accent)' : isMismatch ? 'rgba(255,60,60,0.2)' : 'var(--border)'}`,
                      borderRadius: 8,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                          fontFamily: "'Press Start 2P', monospace",
                          fontSize: 'calc(7px * var(--font-scale))',
                          color: isMatch ? 'var(--accent)' : 'var(--accent)',
                          textTransform: 'uppercase',
                        }}>
                          {info.label}
                        </span>
                        <span style={{
                          fontSize: '0.6rem',
                          color: 'var(--text-muted)',
                          opacity: 0.5,
                          fontFamily: "'VT323', monospace",
                        }}>
                          {info.bits}-bit · {info.note}
                        </span>
                      </div>
                      <button
                        className="hash-copy-btn"
                        onClick={() => copyToClipboard(result.hashes[algo], algo)}
                        title="Copy to clipboard"
                        style={{
                          borderRadius: 6,
                          fontSize: 'calc(6px * var(--font-scale))',
                          padding: '4px 10px',
                        }}
                      >
                        {copied === algo ? '✓ Copied' : '📋 Copy'}
                      </button>
                    </div>
                    <div style={{
                      fontFamily: "'VT323', monospace",
                      fontSize: 15,
                      color: isMatch ? 'var(--accent)' : 'var(--text-secondary)',
                      wordBreak: 'break-all',
                      lineHeight: 1.4,
                      letterSpacing: 0.5,
                      userSelect: 'all',
                    }}>
                      {result.hashes[algo]}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Copy All button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={copyAll}
                style={{ fontSize: 'calc(6px * var(--font-scale))' }}
              >
                {copied === 'all' ? '✓ All Copied' : '📋 Copy All Hashes'}
              </button>
            </div>

            {/* Compare section */}
            <div className="section-divider" />
            <div style={{
              padding: '16px',
              background: 'var(--bg-elevated)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}>
              <label className="form-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🔍</span> Verify Hash
              </label>
              <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: 10, fontFamily: "'VT323', monospace", opacity: 0.6 }}>
                Paste an expected hash below to check if it matches any algorithm
              </p>
              <input
                className="form-input"
                placeholder="Paste expected hash here…"
                value={compareVal}
                onChange={e => setCompareVal(e.target.value)}
                style={{ fontFamily: "'VT323', monospace", fontSize: 15, letterSpacing: 0.5 }}
              />

              {compareClean && (
                <div
                  className={`result-banner ${matchAlgo ? 'success' : 'error'}`}
                  style={{ marginTop: 12, borderRadius: 6 }}
                >
                  {matchAlgo
                    ? `✓ Match found — ${ALGO_INFO[matchAlgo].label} hash is identical. File is authentic.`
                    : '✗ No match — hash does not match any algorithm. File may be altered or corrupted.'}
                </div>
              )}
            </div>
          </>
        )}

        {result && !result.success && (
          <div className="result-banner error" style={{ marginTop: 12 }}>✗ {result.error}</div>
        )}
      </div>
    </div>
  )
}
