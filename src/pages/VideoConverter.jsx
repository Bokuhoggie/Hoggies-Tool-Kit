import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { IconVideo } from '../components/Icons.jsx'
import { getDropPaths } from '../dropHelpers.js'
import WaveformPlayer from '../components/WaveformPlayer.jsx'
import { savePageState, loadPageState } from '../pageCache.js'

const FORMATS    = ['mp4', 'mkv', 'avi', 'mov', 'webm']
// Audio-only targets: the video track is dropped and only the sound is kept.
// The backend picks the encoder from the container, so these need no extra settings.
const AUDIO_FORMATS = ['mp3', 'm4a', 'wav', 'flac']
const isAudioFormat = (f) => AUDIO_FORMATS.includes(f)
const RESOLUTIONS = ['', '1920x1080', '1280x720', '854x480', '640x360']
const CODECS     = ['', 'libx264', 'libx265', 'vp9', 'libvpx']
const ACODECS    = ['aac', 'mp3', 'copy', 'libopus']
const ABITRATES  = ['128k', '192k', '256k', '320k']
const FPS_OPTS   = ['', '24', '30', '60']
const HW_OPTS    = [
  { value: '',        label: 'None (CPU)' },
  { value: 'cuda',    label: 'NVENC (NVIDIA)' },
  { value: 'dxva2',   label: 'DXVA2 (Windows)' },
  { value: 'qsv',     label: 'QuickSync (Intel)' },
  { value: 'd3d11va', label: 'D3D11VA (Windows)' },
]
const api = window.htk
const CACHE_KEY = 'video'

export default function VideoConverter() {
  const { state } = useLocation()
  const [cached] = useState(() => loadPageState(CACHE_KEY))
  const [tab, setTab] = useState('convert')

  const [files, setFiles]               = useState(cached?.files || [])
  const [outputFormat, setOutputFormat] = useState(cached?.outputFormat || 'mp4')
  const [resolution, setResolution]   = useState(cached?.resolution || '')
  const [codec, setCodec]             = useState(cached?.codec || '')
  const [crf, setCrf]                 = useState(cached?.crf ?? 23)
  const [outputDir, setOutputDir]     = useState(cached?.outputDir || '')
  const [results, setResults]           = useState([])
  const [loading, setLoading]         = useState(false)
  const [progress, setProgress]       = useState(null)
  useEffect(() => { window.dispatchEvent(new CustomEvent('blade-busy', { detail: { route: '/video', busy: loading } })) }, [loading])
  const [dragOver, setDragOver]       = useState(false)
  const [currentIdx, setCurrentIdx]     = useState(-1)
  const [isFlashing, setIsFlashing]     = useState(false)
  const [customName, setCustomName]     = useState('')

  const [audioCodec, setAudioCodec]     = useState('aac')
  const [audioBitrate, setAudioBitrate] = useState('192k')
  const [fps, setFps]                   = useState('')
  const [hwAccel, setHwAccel]           = useState('')
  const [previewFile, setPreviewFile]   = useState(null)

  // Save state on unmount
  useEffect(() => {
    return () => {
      savePageState(CACHE_KEY, { files, outputFormat, resolution, codec, crf, outputDir })
    }
  })

  useEffect(() => {
    if (cached) return
    api.settings?.read().then(s => {
      if (!s) return
      if (s.general?.defaultOutputDir) setOutputDir(s.general.defaultOutputDir)
      if (s.video?.format)       setOutputFormat(s.video.format)
      if (s.video?.codec !== undefined) setCodec(s.video.codec)
      if (s.video?.crf   !== undefined) setCrf(s.video.crf)
      if (s.video?.audioCodec)   setAudioCodec(s.video.audioCodec)
      if (s.video?.audioBitrate) setAudioBitrate(s.video.audioBitrate)
      if (s.video?.fps !== undefined) setFps(s.video.fps)
      if (s.video?.hwAccel !== undefined) setHwAccel(s.video.hwAccel)
    }).catch(() => {})
  }, [cached])

  const basename = (p) => p ? p.split('/').pop().split('\\').pop() : ''

  // Picking an audio container turns this page into an audio extractor — the
  // video-side controls stop applying, so they are disabled rather than lying.
  const audioOnly = isAudioFormat(outputFormat)

  const addFiles = useCallback((paths, autoPreview = false) => {
    setFiles(prev => {
      const unique = paths.filter(p => p && !prev.some(f => f.path === p))
      if (!unique.length) return prev
      const objects = unique.map(p => ({ path: p, selected: true }))
      if (prev.length + unique.length > 1) setCustomName('')
      if (autoPreview && unique.length === 1) setPreviewFile(unique[0])
      return [...prev, ...objects]
    })
    setResults([])
  }, [])

  const [lastRouteFile, setLastRouteFile] = useState(null)
  if (state?.file && state.file !== lastRouteFile) {
    setLastRouteFile(state.file)
    addFiles([state.file], true)
  }

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const paths = getDropPaths(e)
    if (paths.length) {
      addFiles(paths, true)
      setIsFlashing(true)
      setTimeout(() => setIsFlashing(false), 500)
      window.dispatchEvent(new CustomEvent('blade-flick', { detail: '/video' }))
    }
  }

  const handleBrowse = async () => {
    const selected = await api.video.selectFile()
    if (selected) {
      const arr = Array.isArray(selected) ? selected : [selected]
      addFiles(arr, true)
    }
  }

  const pickOutputDir = async () => {
    const dir = await api.selectOutputDir()
    if (dir) setOutputDir(dir)
  }

  const convert = async () => {
    const selectedFiles = files.filter(f => f.selected).map(f => f.path)
    if (!selectedFiles.length) return
    if (!outputDir) { alert('Please select an output folder first.'); return }
    setLoading(true); setResults([])
    api.video.onProgress(data => setProgress(data))
    const allResults = []
    
    for (let i = 0; i < files.length; i++) {
      if (!files[i].selected) continue;
      setCurrentIdx(i); setProgress(null)
      try {
        const res = await api.video.convert({
          filePath: files[i].path, outputFormat, outputDir,
          resolution: resolution || undefined,
          codec: codec || undefined, crf,
          audioCodec: audioCodec || undefined,
          audioBitrate: audioBitrate || undefined,
          fps: fps || undefined,
          hwAccel: hwAccel || undefined,
          outputName: (files.filter(f => f.selected).length === 1 && customName.trim()) ? customName.trim() : undefined,
        })
        allResults.push({ ...res, inputPath: files[i].path })
      } catch (err) {
        allResults.push({ success: false, error: err?.message || 'Conversion failed', inputPath: files[i].path })
      }
    }
    
    api.video.offProgress()
    setResults(allResults); setProgress(null); setLoading(false); setCurrentIdx(-1)
  }

  return (
    <div className="page-anim">
      <div className="page-header">
        <h1 className="page-title"><IconVideo size={20} /> Video Converter</h1>
        <p className="page-subtitle">Convert videos between MP4, MKV, AVI, MOV, and WebM</p>
      </div>

      <div className="card">
        <div className="tabs">
          <button className={`tab-btn${tab === 'convert'  ? ' active' : ''}`} onClick={() => setTab('convert')}>Convert</button>
          <button className={`tab-btn${tab === 'advanced' ? ' active' : ''}`} onClick={() => setTab('advanced')}>⚙ Advanced</button>
        </div>

        {tab === 'convert' && (
          <>
            <div
              className={`dropzone${dragOver ? ' drag-over' : ''}${isFlashing ? ' flash-active' : ''}`}
              onClick={handleBrowse}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
              onDrop={handleDrop}
            >
              <div className="dropzone-icon"><IconVideo size={36} /></div>
              <div className="dropzone-title">Drop videos here or click to browse</div>
              <div className="dropzone-sub">MP4, MKV, AVI, MOV, WebM, WMV and more — multiple files OK</div>
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="form-label">Files ({files.filter(f => f.selected).length}/{files.length} selected)</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const allSelected = files.every(f => f.selected)
                    setFiles(files.map(f => ({ ...f, selected: !allSelected })))
                  }}
                >
                  {files.every(f => f.selected) ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            )}

            {files.length > 0 && (
              <div className="file-list" style={{ marginTop: 4 }}>
                {files.map((fileObj, i) => {
                  const result = results.find(r => r.inputPath === fileObj.path)
                  const isCurrent = loading && i === currentIdx
                  return (
                    <div key={i} className="file-item" style={{ opacity: fileObj.selected ? 1 : 0.5 }}>
                      <input
                        type="checkbox"
                        checked={fileObj.selected}
                        onChange={(e) => {
                          const next = [...files]
                          next[i].selected = e.target.checked
                          setFiles(next)
                        }}
                        style={{ accentColor: 'var(--accent)', marginRight: 4, cursor: 'pointer' }}
                        title="Toggle conversion for this file"
                      />
                      <span className="file-item-icon"><IconVideo size={16} /></span>
                      <span
                        className="file-item-name"
                        title={fileObj.path}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setPreviewFile(previewFile === fileObj.path ? null : fileObj.path) }}
                      >{basename(fileObj.path)}</span>
                      {isCurrent && progress && (
                        <span className="file-item-status pending">{Math.round(progress.percent || 0)}%</span>
                      )}
                      {result && (
                        <span 
                          className={`file-item-status ${result.success ? 'success' : 'error'}`}
                          title={result.error || ''}
                        >
                          {result.success ? '✓ Done' : '✗ Error'}
                        </span>
                      )}
                      {!loading && <button className="file-remove-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>}
                    </div>
                  )
                })}
              </div>
            )}

            {previewFile && (
              <div className="media-preview">
                <WaveformPlayer
                  filePath={previewFile}
                  type="video"
                  accentColor="var(--text-primary)"
                  label={`Preview — ${basename(previewFile)}`}
                  onClose={() => setPreviewFile(null)}
                />
              </div>
            )}

            {files.filter(f => f.selected).length === 1 && (
              <div className="form-group" style={{ marginTop: 8, marginBottom: 0 }}>
                <label className="form-label">Output Filename <span style={{ opacity: 0.5, fontWeight: 400 }}>(optional)</span></label>
                <input
                  className="form-input"
                  type="text"
                  placeholder={`${basename(files.find(f => f.selected)?.path ?? '').replace(/\.[^.]+$/, '')} (keep original name)`}
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  disabled={loading}
                />
              </div>
            )}

            {loading && progress && currentIdx >= 0 && files[currentIdx] && (
              <div className="progress-wrap">
                <div className="progress-label">
                  <span>Converting {basename(files[currentIdx].path)}…</span>
                  <span>{progress?.timemark ? `[${progress.timemark}]` : ''} {Math.round(progress.percent || 0)}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${progress?.percent || 0}%` }} />
                </div>
              </div>
            )}

            <div className="controls-row">
              <div className="form-group">
                <label className="form-label">Output Format</label>
                <select className="form-select" value={outputFormat} onChange={e => setOutputFormat(e.target.value)}>
                  <optgroup label="Video">
                    {FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                  </optgroup>
                  <optgroup label="Audio only (drops the video)">
                    {AUDIO_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                  </optgroup>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Resolution</label>
                <select
                  className="form-select"
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  disabled={audioOnly}
                  title={audioOnly ? 'Not used — the video track is being dropped' : undefined}
                >
                  <option value="">Original</option>
                  {RESOLUTIONS.filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Video Codec</label>
                <select
                  className="form-select"
                  value={codec}
                  onChange={e => setCodec(e.target.value)}
                  disabled={audioOnly}
                  title={audioOnly ? 'Not used — the video track is being dropped' : undefined}
                >
                  <option value="">Auto</option>
                  {CODECS.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  {audioOnly ? 'Quality (CRF): n/a' : `Quality (CRF): ${crf}`}
                </label>
                <div className="range-wrap">
                  <input
                    type="range"
                    min={0}
                    max={51}
                    value={crf}
                    onChange={e => setCrf(+e.target.value)}
                    disabled={audioOnly}
                  />
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={pickOutputDir}>📁 Output Folder</button>
              <button 
                className="btn btn-primary" 
                onClick={convert} 
                disabled={loading || !files.some(f => f.selected)}
              >
                {loading ? <span className="spinner">⟳</span> : null}
                {loading
                  ? (audioOnly ? 'Extracting…' : 'Converting…')
                  : (() => {
                      const n = files.filter(f => f.selected).length
                      const what = n > 1 ? `${n} files` : (audioOnly ? 'Audio' : 'Video')
                      return `${audioOnly ? 'Extract' : 'Convert'} ${what}`
                    })()
                }
              </button>
            </div>
          </>
        )}

        {tab === 'advanced' && (
          <div className="advanced-grid">
            <div className="form-group">
              <label className="form-label">Audio Codec</label>
              <select className="form-select" value={audioCodec} onChange={e => setAudioCodec(e.target.value)}>
                {ACODECS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Audio Bitrate</label>
              <select className="form-select" value={audioBitrate} onChange={e => setAudioBitrate(e.target.value)}>
                {ABITRATES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Frame Rate</label>
              <select className="form-select" value={fps} onChange={e => setFps(e.target.value)}>
                <option value="">Original</option>
                {FPS_OPTS.filter(Boolean).map(f => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">HW Acceleration</label>
              <select className="form-select" value={hwAccel} onChange={e => setHwAccel(e.target.value)}>
                {HW_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="adv-note">
              Advanced settings apply to the current session only.<br/>
              Set permanent defaults in ⚙ Settings.
            </div>
          </div>
        )}

        {outputDir && (
          <div className="output-path-row">
            <span className="output-folder-icon">📂</span>
            <span className="output-path-text">{outputDir}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => api.shell.openPath(outputDir)}>Open ↗</button>
          </div>
        )}

        {results.length > 0 && (
          <div className={`result-banner ${results.every(r => r.success) ? 'success' : 'error'}`}>
            {results.every(r => r.success)
              ? `✓ All ${results.length} files converted`
              : `⚠ ${results.filter(r => !r.success).length} file(s) failed`}
          </div>
        )}
      </div>
    </div>
  )
}
