import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { IconPDF } from '../components/Icons.jsx'
import { getDropPaths } from '../dropHelpers.js'
import { savePageState, loadPageState } from '../pageCache.js'

const api = window.htk



function MergeTab() {
  const [cached] = useState(() => loadPageState('pdf-merge'))
  const [files, setFiles] = useState(cached?.files || [])
  const [outputDir, setOutputDir] = useState(cached?.outputDir || '')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  useEffect(() => { window.dispatchEvent(new CustomEvent('blade-busy', { detail: { route: '/pdf', busy: loading } })) }, [loading])

  useEffect(() => {
    return () => { savePageState('pdf-merge', { files, outputDir }) }
  })

  useEffect(() => {
    if (cached) return
    api.settings?.read().then(s => {
      if (!s) return
      if (s.general?.defaultOutputDir) setOutputDir(s.general.defaultOutputDir)
    }).catch(() => {})
  }, [cached])

  const basename = (p) => p?.split('/').pop().split('\\').pop()

  const addFiles = (paths) => {
    const pdfs = paths.filter(p => p.toLowerCase().endsWith('.pdf'))
    setFiles(prev => [...prev, ...pdfs.filter(f => !prev.includes(f))])
    setResult(null)
  }

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const paths = getDropPaths(e)
    if (paths.length) {
      addFiles(paths)
      window.dispatchEvent(new CustomEvent('blade-flick', { detail: '/pdf' }))
    }
  }

  const pickFiles = async () => {
    const selected = await api.pdf.selectFiles()
    if (selected.length) addFiles(selected)
  }

  const pickOutputDir = async () => {
    const dir = await api.selectOutputDir()
    if (dir) setOutputDir(dir)
  }

  const merge = async () => {
    if (files.length < 2) { alert('Select at least 2 PDFs to merge.'); return }
    if (!outputDir) { alert('Select an output folder.'); return }
    setLoading(true)
    try {
      const res = await api.pdf.merge({ filePaths: files, outputDir })
      setResult(res)
    } catch (err) {
      setResult({ success: false, error: err?.message || 'Merge failed' })
    }
    setLoading(false)
  }

  return (
    <div>
      <div
        className={`dropzone${dragOver ? ' drag-over' : ''}`}
        style={{ marginBottom: 16, padding: '24px' }}
        onClick={pickFiles}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
        onDrop={handleDrop}
      >
        <div className="dropzone-icon"><IconPDF size={28} /></div>
        <div className="dropzone-title" style={{ fontSize: 7 }}>Drop PDFs here or click to browse</div>
        <div className="dropzone-sub">Multiple files OK — merge order matches list order</div>
      </div>

      {files.length > 0 && (
        <div className="file-list">
          {files.map((f, i) => (
            <div key={i} className="file-item">
              <span className="file-item-icon">📄</span>
              <span className="file-item-name">{basename(f)}</span>
              <button
                className="file-remove-btn"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                disabled={loading}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="controls-row" style={{ marginTop: 16 }}>
        <button className="btn btn-secondary" onClick={pickOutputDir} disabled={loading}>📁 Output Folder</button>
        <button className="btn btn-primary" onClick={merge} disabled={loading || files.length < 2}>
          {loading ? <span className="spinner">⟳</span> : '🔗'} Merge PDFs
        </button>
      </div>

      {outputDir && (
        <div className="output-path-row">
          <span className="output-folder-icon">📂</span>
          <span className="output-path-text">{outputDir}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => api.shell.openPath(outputDir)}>Open ↗</button>
        </div>
      )}
      {result && (
        <div className={`result-banner ${result.success ? 'success' : 'error'}`}>
          {result.success ? `✓ Merged PDF saved: ${basename(result.outputPath)}` : `✗ ${result.error}`}
        </div>
      )}
    </div>
  )
}

function SplitTab() {
  const [file, setFile] = useState(null)
  const [outputDir, setOutputDir] = useState('')
  const [rangeStr, setRangeStr] = useState('1-3')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => { window.dispatchEvent(new CustomEvent('blade-busy', { detail: { route: '/pdf', busy: loading } })) }, [loading])

  useEffect(() => {
    api.settings?.read().then(s => {
      if (!s) return
      if (s.general?.defaultOutputDir) setOutputDir(s.general.defaultOutputDir)
    }).catch(() => {})
  }, [])

  const basename = (p) => p?.split('/').pop().split('\\').pop()

  const pickFile = async () => {
    const f = await api.pdf.selectFile()
    if (f) setFile(f)
  }

  const pickOutputDir = async () => {
    const dir = await api.selectOutputDir()
    if (dir) setOutputDir(dir)
  }

  const parseRanges = (str) => {
    return str.split(',').map(r => {
      const [s, e] = r.trim().split('-').map(Number)
      return { start: s, end: e || s }
    }).filter(r => !isNaN(r.start))
  }

  const split = async () => {
    if (!file) { alert('Select a PDF.'); return }
    if (!outputDir) { alert('Select an output folder.'); return }
    setLoading(true)
    try {
      const ranges = parseRanges(rangeStr)
      const res = await api.pdf.split({ filePath: file, outputDir, ranges })
      setResult(Array.isArray(res) ? res : [res])
    } catch (err) {
      setResult([{ success: false, error: err?.message || 'Split failed' }])
    }
    setLoading(false)
  }

  return (
    <div>
      <div className="controls-row" style={{ marginBottom: 16, alignItems: 'center' }}>
        <button className="btn btn-secondary" onClick={pickFile} disabled={loading}>📄 Select PDF</button>
        {file && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{basename(file)}</span>}
      </div>
      <div className="form-group" style={{ marginBottom: 16 }}>
        <label className="form-label">Page Ranges (e.g. 1-3, 5-8, 10)</label>
        <input className="form-input" value={rangeStr} onChange={e => setRangeStr(e.target.value)} placeholder="1-3, 5-8" />
      </div>
      <div className="controls-row">
        <button className="btn btn-secondary" onClick={pickOutputDir} disabled={loading}>📁 Output Folder</button>
        <button className="btn btn-primary" onClick={split} disabled={loading || !file}>
          {loading ? <span className="spinner">⟳</span> : '✂'} Split PDF
        </button>
      </div>
      {outputDir && (
        <div className="output-path-row">
          <span className="output-folder-icon">📂</span>
          <span className="output-path-text">{outputDir}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => api.shell.openPath(outputDir)}>Open ↗</button>
        </div>
      )}
      {result && result.length > 0 && (
        <div className={`result-banner ${result.every(r => r.success) ? 'success' : 'error'}`}>
          {result.every(r => r.success) ? `✓ Split into ${result.length} file(s)` : `✗ ${result.find(r => !r.success)?.error}`}
        </div>
      )}
    </div>
  )
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function CompressTab({ preloadFile }) {
  const [file, setFile] = useState(null)
  const [fileSize, setFileSize] = useState(null)
  const [outputDir, setOutputDir] = useState('')
  const [mode, setMode] = useState('standard') // 'standard' or 'target'
  const [targetSizeMB, setTargetSizeMB] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progressMsg, setProgressMsg] = useState(null)
  useEffect(() => { window.dispatchEvent(new CustomEvent('blade-busy', { detail: { route: '/pdf', busy: loading } })) }, [loading])

  useEffect(() => {
    api.settings?.read().then(s => {
      if (!s) return
      if (s.general?.defaultOutputDir)      setOutputDir(s.general.defaultOutputDir)
    }).catch(() => {})
  }, [])

  const basename = (p) => p?.split('/').pop().split('\\').pop()

  const selectFile = useCallback(async (f) => {
    setFile(f)
    setResult(null)
    setFileSize(null)
    const res = await api.pdf.fileSize(f)
    if (res?.success) setFileSize(res.size)
  }, [])

  const [lastPreloadFile, setLastPreloadFile] = useState(null)
  if (preloadFile && preloadFile !== lastPreloadFile) {
    setLastPreloadFile(preloadFile)
    selectFile(preloadFile)
  }

  const pickFile = async () => {
    const f = await api.pdf.selectFile()
    if (f) selectFile(f)
  }
  const pickOutputDir = async () => { const dir = await api.selectOutputDir(); if (dir) setOutputDir(dir) }

  const compress = async () => {
    if (!file || !outputDir) { alert('Select a PDF and output folder.'); return }
    setLoading(true); setResult(null); setProgressMsg(null)

    try {
      let res
      if (mode === 'target' && targetSizeMB) {
        api.pdf.onCompressProgress((data) => setProgressMsg(data.status))
        res = await api.pdf.compressToSize({ filePath: file, outputDir, targetSizeMB: parseFloat(targetSizeMB) })
        api.pdf.offCompressProgress()
      } else {
        res = await api.pdf.compress({ filePath: file, outputDir })
      }
      setResult(res)
    } catch (err) {
      setResult({ success: false, error: err?.message || 'Compression failed' })
    }
    setLoading(false); setProgressMsg(null)
  }

  return (
    <div>
      <div className="controls-row" style={{ marginBottom: 16, alignItems: 'center' }}>
        <button className="btn btn-secondary" onClick={pickFile} disabled={loading}>📄 Select PDF</button>
        {file && (
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {basename(file)}
            {fileSize != null && <span style={{ opacity: 0.6, marginLeft: 8 }}>({formatSize(fileSize)})</span>}
          </span>
        )}
      </div>

      {/* Mode toggle */}
      <div className="controls-row" style={{ marginBottom: 12, gap: 8 }}>
        <button
          className={`tab-btn${mode === 'standard' ? ' active' : ''}`}
          onClick={() => setMode('standard')}
          disabled={loading}
          style={{ fontSize: 'calc(6px * var(--font-scale))' }}
        >
          Standard
        </button>
        <button
          className={`tab-btn${mode === 'target' ? ' active' : ''}`}
          onClick={() => setMode('target')}
          disabled={loading}
          style={{ fontSize: 'calc(6px * var(--font-scale))' }}
        >
          Target File Size
        </button>
      </div>

      {mode === 'standard' && (
        <div style={{
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: '15px',
          fontFamily: "'VT323', monospace",
          color: 'var(--text-secondary)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
        }}>
          Applies lossless stream compression to reduce file size without altering content.
        </div>
      )}

      {mode === 'target' && (
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">Target Size (MB)</label>
          <input
            className="form-input"
            type="number"
            min={0.1}
            step={0.1}
            value={targetSizeMB}
            onChange={e => setTargetSizeMB(e.target.value)}
            placeholder={fileSize ? `Current: ${(fileSize / (1024 * 1024)).toFixed(1)} MB` : 'e.g. 2.0'}
            disabled={loading}
          />
        </div>
      )}

      {loading && progressMsg && (
        <div style={{
          padding: '8px 12px',
          marginBottom: 12,
          fontSize: 'calc(6px * var(--font-scale))',
          fontFamily: "'Press Start 2P', monospace",
          color: 'var(--text-secondary)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
        }}>
          <span className="spinner" style={{ fontSize: 10, marginRight: 8 }}>⟳</span>
          {progressMsg}
        </div>
      )}

      <div className="controls-row">
        <button className="btn btn-secondary" onClick={pickOutputDir} disabled={loading}>📁 Output Folder</button>
        <button className="btn btn-primary" onClick={compress} disabled={loading || !file || (mode === 'target' && !targetSizeMB)} style={{ whiteSpace: 'nowrap' }}>
          {loading ? <span className="spinner">⟳</span> : '🗜'} Compress PDF
        </button>
      </div>
      {outputDir && (
        <div className="output-path-row">
          <span className="output-folder-icon">📂</span>
          <span className="output-path-text">{outputDir}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => api.shell.openPath(outputDir)}>Open ↗</button>
        </div>
      )}
      {result && (
        <div className={`result-banner ${result.success ? 'success' : 'error'}`}>
          {result.success
            ? <>
                ✓ Compressed: {basename(result.outputPath)}
                {result.originalSize && result.finalSize && (
                  <span style={{ opacity: 0.8, marginLeft: 6 }}>
                    — {formatSize(result.originalSize)} → {formatSize(result.finalSize)}
                    {' '}({Math.round((1 - result.finalSize / result.originalSize) * 100)}% reduction)
                  </span>
                )}
                {result.hitTarget === false && (
                  <span style={{ display: 'block', marginTop: 4, opacity: 0.7 }}>
                    ⚠ Could not reach target — this is the smallest achievable size
                  </span>
                )}
              </>
            : `✗ ${result.error}`}
        </div>
      )}
    </div>
  )
}

const TABS = ['Merge', 'Split', 'Compress']

export default function PdfTools() {
  const { state } = useLocation()
  const [activeTab, setActiveTab] = useState('Merge')
  const [inspectorFile, setInspectorFile] = useState(null)
  const [lastRouteFile, setLastRouteFile] = useState(null)

  // React 19 idiom: react to route-state changes during render rather than in an effect.
  if (state?.file && state.file !== lastRouteFile) {
    setLastRouteFile(state.file)
    setActiveTab('Compress')
    setInspectorFile(state.file)
  }
  return (
    <div className="page-anim">
      <div className="page-header">
        <h1 className="page-title"><IconPDF size={20} /> PDF Tools</h1>
        <p className="page-subtitle">Merge, split, and compress PDF documents locally</p>
      </div>
      <div className="card">
        <div className="tabs">
          {TABS.map(t => (
            <button key={t} className={`tab-btn${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>
        {activeTab === 'Merge'    && <MergeTab />}
        {activeTab === 'Split'    && <SplitTab />}
        {activeTab === 'Compress' && <CompressTab preloadFile={inspectorFile} />}
      </div>
    </div>
  )
}
