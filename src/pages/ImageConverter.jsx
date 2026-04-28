import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { IconImage } from '../components/Icons.jsx'
import { getDropPaths } from '../dropHelpers.js'
import logoGoff from '../assets/logos/logo-Goff.png'
import { useTheme } from '../contexts/ThemeContext'
import { savePageState, loadPageState } from '../pageCache.js'

const FORMATS = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'ico']
const ICO_PRESETS = {
  '256':       { label: '256×256 (standard)',       sizes: [256] },
  '128':       { label: '128×128',                  sizes: [128] },
  '64':        { label: '64×64',                    sizes: [64] },
  '48':        { label: '48×48 (Windows shell)',     sizes: [48] },
  '32':        { label: '32×32 (taskbar)',           sizes: [32] },
  '16':        { label: '16×16 (favicon)',           sizes: [16] },
  'multi-std': { label: 'Multi (16+32+48+256)',      sizes: [16, 32, 48, 256] },
  'multi-all': { label: 'Multi (16+32+48+64+128+256)', sizes: [16, 32, 48, 64, 128, 256] },
}
const api = window.htk
const CACHE_KEY = 'image'

export default function ImageConverter() {
  const { state } = useLocation()
  const [cached] = useState(() => loadPageState(CACHE_KEY))
  const [tab, setTab] = useState('convert')

  const [files, setFiles]               = useState(cached?.files || [])
  const [outputFormat, setOutputFormat] = useState(cached?.outputFormat || 'png')
  const [quality, setQuality]           = useState(cached?.quality ?? 85)
  const [outputDir, setOutputDir]       = useState(cached?.outputDir || '')
  const [results, setResults]           = useState([])
  const [loading, setLoading]           = useState(false)
  const [dragOver, setDragOver]         = useState(false)
  const [customName, setCustomName]     = useState('')
  const [icoPreset, setIcoPreset]       = useState('256')
  useEffect(() => { window.dispatchEvent(new CustomEvent('blade-busy', { detail: { route: '/image', busy: loading } })) }, [loading])
  const [isFlashing, setIsFlashing]     = useState(false)

  // ── Remove BG tab state ──
  const [bgFile, setBgFile]           = useState('')
  const [bgStatus, setBgStatus]       = useState('idle')
  const [bgDragOver, setBgDragOver]   = useState(false)
  const [bgTolerance, setBgTolerance] = useState(30)
  const [bgMode, setBgMode]           = useState('corner') // 'corner' | 'color' | 'custom'
  const [bgCustomColor, setBgCustomColor] = useState('#ffffff')
  const [bgOutputName, setBgOutputName] = useState('')
  const [bgPreviewBefore, setBgPreviewBefore] = useState(null)
  const [bgPreviewAfter, setBgPreviewAfter]   = useState(null)
  const [bgEyedropper, setBgEyedropper]       = useState(false)

  // Advanced
  const [width, setWidth]               = useState('')
  const [height, setHeight]             = useState('')

  // Save state on unmount
  useEffect(() => {
    return () => {
      savePageState(CACHE_KEY, { files, outputFormat, quality, outputDir })
    }
  })

  useEffect(() => {
    if (cached) return
    api.settings?.read().then(s => {
      if (!s) return
      if (s.general?.defaultOutputDir)  setOutputDir(s.general.defaultOutputDir)
      if (s.image?.format)              setOutputFormat(s.image.format)
      if (s.image?.quality !== undefined) setQuality(s.image.quality)
      if (s.image?.width  !== undefined) setWidth(s.image.width)
      if (s.image?.height !== undefined) setHeight(s.image.height)

    }).catch(() => {})
  }, [cached])

  const basename = (p) => p ? p.split('/').pop().split('\\').pop() : ''

  const [previews, setPreviews] = useState({}) // { [path]: dataURL }

  const addFiles = useCallback((paths) => {
    setFiles(prev => {
      const unique = paths.filter(p => p && !prev.some(f => f.path === p))
      if (!unique.length) return prev
      const objects = unique.map(p => ({ path: p, selected: true }))
      // Load thumbnails for new files
      unique.forEach(p => {
        api.image.readAsDataURL(p).then(url => {
          if (url) setPreviews(pr => ({ ...pr, [p]: url }))
        }).catch(() => {})
      })
      if (prev.length + unique.length > 1) setCustomName('')
      // If Remove BG tab has no file, pick the first one
      setBgFile(curBg => {
        if (!curBg) {
          setBgStatus('idle')
          return unique[0]
        }
        return curBg
      })
      return [...prev, ...objects]
    })
    setResults([])
  }, [])

  useEffect(() => {
    if (state?.file) addFiles([state.file])
  }, [state?.file, addFiles])

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const paths = getDropPaths(e)
    if (paths.length) {
      addFiles(paths)
      setIsFlashing(true)
      setTimeout(() => setIsFlashing(false), 500)
      window.dispatchEvent(new CustomEvent('blade-flick', { detail: '/image' }))
    }
  }

  const handleBrowse = async () => {
    const selected = await api.image.selectFiles()
    if (selected.length) addFiles(selected)
  }

  const pickOutputDir = async () => {
    const dir = await api.selectOutputDir()
    if (dir) setOutputDir(dir)
  }

  // ── Remove BG handlers ──
  const handleBgBrowse = async () => {
    const selected = await api.image.selectFiles()
    if (selected.length) { setBgFile(selected[0]); setBgStatus('idle'); setBgPreviewAfter(null) }
  }
  const handleBgDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setBgDragOver(false)
    const paths = getDropPaths(e)
    if (paths.length) { setBgFile(paths[0]); setBgStatus('idle'); setBgPreviewAfter(null) }
  }
  // Auto-load preview when file is selected
  useEffect(() => {
    if (!bgFile) { setBgPreviewBefore(null); return }
    api.image.readAsDataURL(bgFile).then(url => setBgPreviewBefore(url)).catch(() => {})
  }, [bgFile])

  // Eyedropper: sample color from click on preview image
  const handleEyedrop = (e) => {
    if (!bgEyedropper) return
    const img = e.target
    const rect = img.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    const px = ctx.getImageData(Math.round(x * scaleX), Math.round(y * scaleY), 1, 1).data
    const hex = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('')
    setBgCustomColor(hex)
    setBgMode('custom')
    setBgEyedropper(false)
  }
  const removeBg = async () => {
    if (!bgFile) return
    if (!outputDir) { alert('Please select an output folder first.'); return }
    setLoading(true); setBgStatus('Processing…'); setBgPreviewBefore(null); setBgPreviewAfter(null)
    try {
      const res = await api.image.removeBg({
        filePath: bgFile, outputDir, outputName: bgOutputName.trim() || undefined,
        tolerance: bgTolerance, mode: bgMode,
        customColor: bgMode === 'custom' ? bgCustomColor : undefined
      })
      if (res.success) {
        setBgStatus('done')
        // Load previews as data URLs (bypasses sk-media:// protocol issues)
        const [before, after] = await Promise.all([
          api.image.readAsDataURL(bgFile),
          api.image.readAsDataURL(res.outputPath)
        ])
        setBgPreviewBefore(before)
        setBgPreviewAfter(after)
      }
      else setBgStatus('Error: ' + res.error)
    } catch (err) {
      setBgStatus('Error: ' + (err?.message || 'Failed'))
    } finally { setLoading(false) }
  }

  const convert = async () => {
    const selectedFiles = files.filter(f => f.selected).map(f => f.path)
    if (!selectedFiles.length) return
    if (!outputDir) { alert('Please select an output folder first.'); return }
    setLoading(true); setResults([])
    try {
      const res = await api.image.convert({
        filePaths: selectedFiles, outputFormat, outputDir, quality,
        width:  width  ? parseInt(width)  : undefined,
        height: height ? parseInt(height) : undefined,

        outputName: (selectedFiles.length === 1 && customName.trim()) ? customName.trim() : undefined,
        icoSizes: outputFormat === 'ico' ? ICO_PRESETS[icoPreset].sizes : undefined,
      })
      setResults(res)
    } catch (err) {
      setResults(selectedFiles.map(f => ({ inputPath: f, success: false, error: err?.message || 'Conversion failed' })))
    } finally {
      setLoading(false)
    }
  }

  const { themeId } = useTheme()
  const isLions = themeId === 'lions'

  return (
    <div className="page-anim">
      <div className="page-header">
        <h1 className="page-title">
          {isLions ? (
            <img 
              src={logoGoff} 
              alt="Goff" 
              style={{
                width: 72,
                height: 50,
                marginRight: 12,
                verticalAlign: 'middle',
                objectFit: 'contain'
              }} 
            />
          ) : (
            <IconImage size={24} style={{ marginRight: 16, verticalAlign: 'middle' }} />
          )}
          Image Converter
        </h1>
        <p className="page-subtitle">Convert images between JPG, PNG, WebP, AVIF, GIF, BMP, TIFF, and ICO</p>
      </div>

      <div className="card">
        <div className="tabs">
          <button className={`tab-btn${tab === 'convert'   ? ' active' : ''}`} onClick={() => setTab('convert')}>Convert</button>
          <button className={`tab-btn${tab === 'removebg'  ? ' active' : ''}`} onClick={() => setTab('removebg')}>✂ Remove BG</button>
          <button className={`tab-btn${tab === 'advanced'  ? ' active' : ''}`} onClick={() => setTab('advanced')}>⚙ Advanced</button>
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
              <div className="dropzone-icon"><IconImage size={36} /></div>
              <div className="dropzone-title">Drop images here or click to browse</div>
              <div className="dropzone-sub">JPG, PNG, WebP, AVIF, GIF, BMP, TIFF, ICO — multiple files OK</div>
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
                      <span className="file-item-icon" style={{ marginLeft: 4 }}>
                        {previews[fileObj.path]
                          ? <img src={previews[fileObj.path]} alt="" style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)' }} />
                          : <IconImage size={16} />}
                      </span>
                      <span className="file-item-name" title={fileObj.path}>{basename(fileObj.path)}</span>
                      {result && (
                        <span 
                          className={`file-item-status ${result.success ? 'success' : 'error'}`}
                          title={result.error || ''}
                        >
                          {result.success ? '✓ Done' : '✗ Error'}
                        </span>
                      )}
                      <button className="file-remove-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  )
                })}
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

            <div className="controls-row">
              <div className="form-group">
                <label className="form-label">Output Format</label>
                <select className="form-select" value={outputFormat} onChange={e => setOutputFormat(e.target.value)}>
                  {FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                </select>
              </div>
              {outputFormat === 'ico' ? (
                <div className="form-group">
                  <label className="form-label">ICO Size</label>
                  <select className="form-select" value={icoPreset} onChange={e => setIcoPreset(e.target.value)}>
                    {Object.entries(ICO_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Quality: {quality}</label>
                  <div className="range-wrap">
                    <input type="range" min={10} max={100} value={quality} onChange={e => setQuality(+e.target.value)} />
                  </div>
                </div>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={pickOutputDir}>📁 Output Folder</button>
              <button 
                className="btn btn-primary" 
                onClick={convert} 
                disabled={loading || !files.some(f => f.selected)}
              >
                {loading ? <span className="spinner">⟳</span> : null}
                {loading 
                  ? 'Converting…' 
                  : `Convert ${files.filter(f => f.selected).length > 1 ? `${files.filter(f => f.selected).length} files` : 'Image'}`
                }
              </button>
            </div>
          </>
        )}

        {tab === 'removebg' && (
          <>
            {/* Drop zone */}
            <div
              className={`dropzone${bgDragOver ? ' drag-over' : ''}`}
              onClick={() => !bgFile && handleBgBrowse()}
              onDragOver={e => { e.preventDefault(); setBgDragOver(true) }}
              onDragLeave={e => { if (e.currentTarget === e.target) setBgDragOver(false) }}
              onDrop={handleBgDrop}
              style={{ cursor: bgFile ? 'default' : 'pointer' }}
            >
              {bgFile ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <IconImage size={20} />
                  <span style={{ color: 'var(--accent)', fontFamily: "'Press Start 2P', monospace", fontSize: '0.5rem' }}>{basename(bgFile)}</span>
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setBgFile(''); setBgStatus('idle'); setBgPreviewBefore(null); setBgPreviewAfter(null); setBgEyedropper(false) }}>✕</button>
                </div>
              ) : (
                <>
                  <div className="dropzone-icon">✂</div>
                  <div className="dropzone-title">Drop an image here or click to browse</div>
                  <div className="dropzone-sub">Detects & removes the background — saves as transparent PNG</div>
                </>
              )}
            </div>

            {/* Detection mode + Tolerance */}
            <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'flex-end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Detection</label>
                <select className="form-select" value={bgMode} onChange={e => setBgMode(e.target.value)} style={{ minWidth: 140 }}>
                  <option value="corner">Auto (corners)</option>
                  <option value="color">Most common color</option>
                  <option value="custom">Pick color</option>
                </select>
              </div>
              {bgMode === 'custom' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Color</label>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="color" value={bgCustomColor} onChange={e => setBgCustomColor(e.target.value)} style={{ width: 40, height: 32, padding: 0, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: 'none' }} />
                    <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', opacity: 0.6 }}>{bgCustomColor}</span>
                  </div>
                </div>
              )}
              {bgPreviewBefore && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">&nbsp;</label>
                  <button
                    className={`btn btn-sm ${bgEyedropper ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setBgEyedropper(!bgEyedropper)}
                    title="Pick color from image"
                    style={{ fontSize: '0.6rem', padding: '6px 10px' }}
                  >
                    💧 Eyedropper
                  </button>
                </div>
              )}
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">
                  Tolerance: {bgTolerance}&nbsp;
                  <span style={{ opacity: 0.45, fontWeight: 400, fontSize: '0.8em' }}>lower = precise · higher = aggressive</span>
                </label>
                <div className="range-wrap">
                  <input type="range" min={5} max={75} value={bgTolerance} onChange={e => setBgTolerance(+e.target.value)} />
                </div>
              </div>
            </div>

            {/* Controls row */}
            <div className="controls-row">
              <button className="btn btn-secondary" onClick={pickOutputDir}>📁 Output Folder</button>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <input className="form-input" placeholder="Output filename (optional, default: original_nobg.png)" value={bgOutputName} onChange={e => setBgOutputName(e.target.value)} disabled={loading} />
              </div>
              <button className="btn btn-primary" onClick={removeBg} disabled={!bgFile || loading}>
                {loading ? <span className="spinner">⟳</span> : '✂'}
                {loading ? ' Removing…' : ' Remove Background'}
              </button>
            </div>

            {/* Status banner */}
            {bgStatus !== 'idle' && (
              <div className={`result-banner ${bgStatus === 'done' ? 'success' : bgStatus.startsWith('Error') ? 'error' : ''}`}>
                {bgStatus === 'done' ? '✓ Background removed — transparent PNG saved' : bgStatus}
              </div>
            )}

            {/* Image preview */}
            {bgPreviewBefore && (
              <div style={{ display: 'grid', gridTemplateColumns: bgPreviewAfter ? '1fr 1fr' : '1fr', gap: 12, marginTop: 12 }}>
                <div>
                  <div className="form-label" style={{ marginBottom: 6 }}>
                    {bgPreviewAfter ? 'Before' : 'Preview'}
                    {bgEyedropper && <span style={{ marginLeft: 8, color: 'var(--accent)', fontSize: '0.7em' }}>click image to pick color</span>}
                  </div>
                  <img
                    src={bgPreviewBefore}
                    crossOrigin="anonymous"
                    onClick={handleEyedrop}
                    style={{
                      width: '100%', maxHeight: 250, objectFit: 'contain',
                      border: `1px solid ${bgEyedropper ? 'var(--accent)' : 'var(--border)'}`,
                      background: 'var(--bg-elevated)',
                      cursor: bgEyedropper ? 'crosshair' : 'default'
                    }}
                    alt="original"
                  />
                </div>
                {bgPreviewAfter && (
                  <div>
                    <div className="form-label" style={{ marginBottom: 6 }}>After</div>
                    <div style={{ background: 'repeating-conic-gradient(#666 0% 25%, #444 0% 50%) 0 0 / 14px 14px', border: '1px solid var(--border)' }}>
                      <img
                        src={bgPreviewAfter}
                        style={{ width: '100%', maxHeight: 250, objectFit: 'contain', display: 'block' }}
                        alt="result"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'advanced' && (
          <div className="advanced-grid">
            <div className="form-group">
              <label className="form-label">Max Width (px)</label>
              <input
                className="form-input"
                type="number" min={1} placeholder="No limit"
                value={width} onChange={e => setWidth(e.target.value)}
                style={{ minWidth: 130 }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Max Height (px)</label>
              <input
                className="form-input"
                type="number" min={1} placeholder="No limit"
                value={height} onChange={e => setHeight(e.target.value)}
                style={{ minWidth: 130 }}
              />
            </div>
            <div className="adv-note">
              Resize uses "fit inside" — aspect ratio is always preserved.<br/>
              Set permanent defaults in ⚙ Settings.
            </div>
          </div>
        )}

        {tab === 'convert' && outputDir && (
          <div className="output-path-row">
            <span className="output-folder-icon">📂</span>
            <span className="output-path-text">{outputDir}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => api.shell.openPath(outputDir)}>Open ↗</button>
          </div>
        )}

        {tab === 'convert' && results.length > 0 && (
          <div className={`result-banner ${results.every(r => r.success) ? 'success' : 'error'}`}>
            {results.every(r => r.success)
              ? `✓ All ${results.length} images converted`
              : `⚠ ${results.filter(r => !r.success).length} file(s) failed`}
          </div>
        )}
      </div>
    </div>
  )
}
