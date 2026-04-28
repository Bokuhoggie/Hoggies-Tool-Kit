import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { IconAudio } from '../components/Icons.jsx'
import { getDropPaths } from '../dropHelpers.js'

const MODELS = [
  { id: 'htdemucs',     label: 'htdemucs · 4-stem (vocals · drums · bass · other)', size: '~84 MB' },
  { id: 'htdemucs_6s',  label: 'htdemucs_6s · 6-stem (adds guitar + piano)',         size: '~84 MB' },
  { id: 'htdemucs_ft',  label: 'htdemucs_ft · 4-stem · fine-tuned (slower, sharper)', size: '~333 MB' },
]

const ALL_STEMS = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano']
const api = window.htk

export default function StemSeparator() {
  const { state } = useLocation()
  const [filePath, setFilePath]       = useState('')
  const [outputDir, setOutputDir]     = useState('')
  const [outputName, setOutputName]   = useState('')
  const [model, setModel]             = useState('htdemucs')
  const [selectedStems, setSelectedStems] = useState(new Set(['vocals', 'drums', 'bass', 'other']))

  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState(null) // { percent, stage }
  const [result, setResult]     = useState(null)
  const [setupStage, setSetupStage] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  // Demucs metadata
  const [demucsVersion, setDemucsVersion] = useState('')
  const [demucsUpdating, setDemucsUpdating] = useState(false)

  useEffect(() => { window.dispatchEvent(new CustomEvent('blade-busy', { detail: { route: '/stems', busy: loading } })) }, [loading])

  useEffect(() => {
    api.settings?.read().then(s => {
      if (s?.general?.defaultOutputDir) setOutputDir(s.general.defaultOutputDir)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    api.stems.onSetup(({ stage }) => {
      setSetupStage(stage)
      if (stage === 'ready') setTimeout(() => setSetupStage(null), 1500)
    })
  }, [])

  const refreshVersion = () => {
    api.stems.demucsVersion().then(r => {
      if (r?.installed && r?.version) setDemucsVersion(r.version)
    }).catch(() => {})
  }
  useEffect(refreshVersion, [])

  const updateDemucs = async () => {
    setDemucsUpdating(true)
    const r = await api.stems.demucsUpdate()
    setDemucsUpdating(false)
    if (r?.success) refreshVersion()
    else alert(`Update failed: ${r?.error || 'unknown error'}`)
  }

  // Auto-load file from File Inspector handoff (same pattern as other pages)
  const [lastRouteFile, setLastRouteFile] = useState(null)
  if (state?.file && state.file !== lastRouteFile) {
    setLastRouteFile(state.file)
    setFilePath(state.file)
  }

  const basename = (p) => p ? p.split('/').pop().split('\\').pop() : ''

  const handleBrowse = async () => {
    const picked = await api.audio.selectFiles()
    if (picked?.length) setFilePath(picked[0])
  }

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const paths = getDropPaths(e)
    if (paths.length) setFilePath(paths[0])
  }

  const pickOutputDir = async () => {
    const dir = await api.selectOutputDir()
    if (dir) setOutputDir(dir)
  }

  const toggleStem = (stem) => {
    setSelectedStems(prev => {
      const next = new Set(prev)
      if (next.has(stem)) next.delete(stem)
      else next.add(stem)
      return next
    })
  }

  const availableStems = model === 'htdemucs_6s'
    ? ALL_STEMS
    : ALL_STEMS.filter(s => s !== 'guitar' && s !== 'piano')

  const separate = async () => {
    if (!filePath) { alert('Pick an audio file first.'); return }
    if (!outputDir) { alert('Pick an output folder first.'); return }

    setLoading(true); setResult(null); setProgress(null)
    api.stems.onProgress(p => setProgress(p))

    const stems = Array.from(selectedStems).filter(s => availableStems.includes(s))
    const res = await api.stems.separate({
      filePath,
      outputDir,
      model,
      stems: stems.length === availableStems.length ? undefined : stems,
      outputName: outputName.trim() || undefined,
    })

    api.stems.offProgress()
    setResult(res); setProgress(null); setLoading(false)
  }

  return (
    <div className="page-anim">
      <div className="page-header">
        <h1 className="page-title"><IconAudio size={20} /> Stem Separator</h1>
        <p className="page-subtitle">Split a track into vocals, drums, bass, and more — runs locally on Apple Silicon (Metal GPU)</p>
      </div>

      <div className="card">
        {/* ─── Input ─── */}
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">Audio File</label>
          <div
            className={`dropzone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }}
            onDrop={handleDrop}
            onClick={handleBrowse}
            style={{ cursor: 'pointer', padding: '20px', textAlign: 'center' }}
          >
            {filePath ? (
              <div>
                <div style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 4 }}>♬ {basename(filePath)}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Click to change · or drop a new file</div>
              </div>
            ) : (
              <div className="dropzone-title" style={{ fontSize: 12 }}>
                Drop audio here or click to browse
              </div>
            )}
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">
            Output Folder Name <span style={{ opacity: 0.5, fontWeight: 400 }}>(optional — defaults to source filename)</span>
          </label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. my-track-stems"
            value={outputName}
            onChange={e => setOutputName(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="section-divider" />

        {/* ─── Model + stems ─── */}
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">Model</label>
          <select className="form-select" value={model} onChange={e => setModel(e.target.value)} disabled={loading}>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label} · {m.size}</option>)}
          </select>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Models download automatically on first use of each variant.
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">Stems to Extract</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {availableStems.map(s => {
              const on = selectedStems.has(s)
              return (
                <button
                  key={s}
                  type="button"
                  className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => toggleStem(s)}
                  disabled={loading}
                  style={{ minWidth: 80, textTransform: 'capitalize' }}
                >
                  {on ? '✓' : ''} {s}
                </button>
              )
            })}
          </div>
        </div>

        <div className="controls-row">
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={pickOutputDir} disabled={loading}>📁 Output Folder</button>
        </div>

        {outputDir && (
          <div className="output-path-row">
            <span className="output-folder-icon">📂</span>
            <span className="output-path-text">{outputDir}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => api.shell.openPath(outputDir)}>Open ↗</button>
          </div>
        )}

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={separate}
            disabled={loading || !filePath || !outputDir || selectedStems.size === 0}
          >
            {loading ? <><span className="spinner">⟳</span> Separating…</> : '✂ Separate Stems'}
          </button>
        </div>

        {/* ─── Setup progress ─── */}
        {setupStage === 'downloading' && (
          <div className="progress-wrap">
            <div className="progress-label">
              <span>Setting up demucs (one-time, ~10 MB)…</span>
            </div>
            <div className="progress-track">
              <div className="progress-bar progress-bar-indeterminate" style={{ width: '40%' }} />
            </div>
          </div>
        )}
        {setupStage === 'extracting' && (
          <div className="progress-wrap">
            <div className="progress-label"><span>Unpacking demucs binary…</span></div>
            <div className="progress-track">
              <div className="progress-bar progress-bar-indeterminate" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {/* ─── Run progress ─── */}
        {loading && setupStage == null && (
          <div className="progress-wrap">
            <div className="progress-label">
              <span>{progress?.stage === 'downloading-model' ? 'Downloading model…'
                  : progress?.stage === 'loading' ? 'Loading model…'
                  : 'Separating stems…'}</span>
              <span>{progress?.percent != null ? `${Math.round(progress.percent)}%` : ''}</span>
            </div>
            <div className="progress-track">
              {progress?.percent != null
                ? <div className="progress-bar" style={{ width: `${progress.percent}%` }} />
                : <div className="progress-bar progress-bar-indeterminate" style={{ width: '40%' }} />}
            </div>
          </div>
        )}

        {result && (
          <div className={`result-banner ${result.success ? 'success' : 'error'}`}>
            {result.success
              ? <>✓ Stems written to: {result.outputDir} <button className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }} onClick={() => api.shell.openPath(result.outputDir)}>Open ↗</button></>
              : `✗ ${result.error}`}
          </div>
        )}

        {/* ─── Engine info ─── */}
        <div className="section-divider" />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-hover)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          fontSize: 12,
        }}>
          <span style={{ color: 'var(--text-muted)' }}>demucs-rs:</span>
          <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
            {demucsVersion || '—'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-secondary btn-sm"
            onClick={updateDemucs}
            disabled={demucsUpdating}
            title="Re-download the latest demucs-rs build"
          >
            {demucsUpdating ? '⟳ Updating…' : '↑ Update'}
          </button>
        </div>
      </div>
    </div>
  )
}
