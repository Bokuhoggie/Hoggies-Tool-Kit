import { useState, useEffect } from 'react'
import { IconDownload } from '../components/Icons.jsx'

const QUALITIES  = ['1080p', '720p', '480p', '360p']
const AFORMATS   = ['mp3', 'aac', 'flac', 'opus', 'wav']
const api = window.htk

// Cookie sources yt-dlp can read, minus the ones that can't exist on this OS.
// Safari is macOS-only; offering it on Windows just produces a yt-dlp error.
const IS_WINDOWS = navigator.userAgent.includes('Windows')
const COOKIE_BROWSERS = [
  ['chrome',  'Chrome'],
  ['firefox', 'Firefox'],
  ['edge',    'Edge'],
  ['brave',   'Brave'],
  ...(IS_WINDOWS ? [] : [['safari', 'Safari']]),
]

export default function Downloader() {
  const [tab, setTab] = useState('download')

  const [url, setUrl]             = useState('')
  const [outputName, setOutputName] = useState('')
  const [formatType, setFormatType] = useState('video')
  const [quality, setQuality]     = useState('1080p')
  const [outputDir, setOutputDir] = useState('')
  const [loading, setLoading]     = useState(false)
  const [progress, setProgress]   = useState(null)
  useEffect(() => { window.dispatchEvent(new CustomEvent('blade-busy', { detail: { route: '/download', busy: loading } })) }, [loading])
  const [result, setResult]       = useState(null)

  // Advanced
  const [audioFormat, setAudioFormat]       = useState('mp3')
  const [embedThumbnail, setEmbedThumbnail] = useState(false)
  const [embedSubs, setEmbedSubs]           = useState(false)
  const [subsLang, setSubsLang]             = useState('en')
  const [rateLimit, setRateLimit]           = useState('')
  const [cookiesFromBrowser, setCookiesFromBrowser] = useState('')

  // yt-dlp metadata
  const [ytDlpVersion, setYtDlpVersion] = useState('')
  const [ytDlpUpdating, setYtDlpUpdating] = useState(false)
  const [setupStage, setSetupStage] = useState(null) // null | 'downloading' | 'ready'

  // First-run binary download notifier — listen once on mount
  useEffect(() => {
    api.downloader.onSetup(({ stage }) => {
      setSetupStage(stage)
      if (stage === 'ready') setTimeout(() => setSetupStage(null), 1500)
    })
  }, [])

  // Probe yt-dlp version on mount (and after updates)
  const refreshYtDlpVersion = () => {
    api.downloader.ytDlpVersion().then(r => {
      if (r?.installed && r?.version) setYtDlpVersion(r.version)
    }).catch(() => {})
  }
  useEffect(refreshYtDlpVersion, [])

  const updateYtDlp = async () => {
    setYtDlpUpdating(true)
    const r = await api.downloader.ytDlpUpdate()
    setYtDlpUpdating(false)
    if (r?.success) refreshYtDlpVersion()
    else alert(`Update failed: ${r?.error || 'unknown error'}`)
  }

  useEffect(() => {
    api.settings?.read().then(s => {
      if (!s) return
      if (s.general?.defaultOutputDir)          setOutputDir(s.general.defaultOutputDir)
      if (s.downloader?.formatType)             setFormatType(s.downloader.formatType)
      if (s.downloader?.quality)                setQuality(s.downloader.quality)
      if (s.downloader?.audioFormat)            setAudioFormat(s.downloader.audioFormat)
      if (s.downloader?.embedThumbnail !== undefined) setEmbedThumbnail(s.downloader.embedThumbnail)
      if (s.downloader?.embedSubs      !== undefined) setEmbedSubs(s.downloader.embedSubs)
      if (s.downloader?.subsLang)               setSubsLang(s.downloader.subsLang)
      if (s.downloader?.rateLimit !== undefined) setRateLimit(s.downloader.rateLimit)
    }).catch(() => {})
  }, [])

  const pickOutputDir = async () => {
    const dir = await api.downloader.selectFolder()
    if (dir) setOutputDir(dir)
  }

  const download = async () => {
    if (!url.trim()) return
    if (!outputDir) { alert('Please select an output folder first.'); return }
    setLoading(true); setResult(null); setProgress(null)
    api.downloader.onProgress(data => setProgress(data))
    const res = await api.downloader.download({
      url: url.trim(), outputDir, formatType, quality,
      audioFormat,
      embedThumbnail,
      embedSubs,
      subsLang,
      rateLimit: rateLimit || undefined,
      outputName: outputName.trim() || undefined,
      cookiesFromBrowser: cookiesFromBrowser || undefined,
    })
    api.downloader.offProgress()
    setResult(res); setProgress(null); setLoading(false)
  }

  return (
    <div className="page-anim">
      <div className="page-header">
        <h1 className="page-title"><IconDownload size={20} /> Video Downloader</h1>
        <p className="page-subtitle">Download videos from YouTube, X/Twitter, Reddit, TikTok, Instagram, and 1000+ sites via yt-dlp</p>
      </div>

      <div className="card">
        <div className="tabs">
          <button className={`tab-btn${tab === 'download' ? ' active' : ''}`} onClick={() => setTab('download')}>Download</button>
          <button className={`tab-btn${tab === 'advanced' ? ' active' : ''}`} onClick={() => setTab('advanced')}>⚙ Advanced</button>
        </div>

        {tab === 'download' && (
          <>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Video URL</label>
              <div className="url-input-group">
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://youtube.com/watch?v=..."
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && download()}
                  disabled={loading}
                />
                <button className="btn btn-primary btn-lg" onClick={download} disabled={loading || !url.trim()}>
                  {loading ? <span className="spinner">⟳</span> : '⬇'}
                  {loading ? 'Downloading…' : 'Download'}
                </button>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Output Filename <span style={{ opacity: 0.5, fontWeight: 400 }}>(optional — leave blank to use video title)</span></label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. my-video  (extension added automatically)"
                value={outputName}
                onChange={e => setOutputName(e.target.value)}
                disabled={loading}
              />
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              Supports: YouTube · X/Twitter · Reddit · TikTok · Instagram · Vimeo · and 1000+ more
            </div>

            <div className="section-divider" />

            <div className="controls-row">
              <div className="form-group">
                <label className="form-label">Format</label>
                <select className="form-select" value={formatType} onChange={e => setFormatType(e.target.value)} disabled={loading}>
                  <option value="video">🎬 Video (MP4)</option>
                  <option value="audio">🎵 Audio only</option>
                </select>
              </div>
              {formatType === 'video' && (
                <div className="form-group">
                  <label className="form-label">Max Quality</label>
                  <select className="form-select" value={quality} onChange={e => setQuality(e.target.value)} disabled={loading}>
                    {QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
                  </select>
                </div>
              )}
              {formatType === 'audio' && (
                <div className="form-group">
                  <label className="form-label">Audio Format</label>
                  <select className="form-select" value={audioFormat} onChange={e => setAudioFormat(e.target.value)} disabled={loading}>
                    {AFORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                  </select>
                </div>
              )}
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

            {setupStage === 'downloading' && (
              <div className="progress-wrap">
                <div className="progress-label">
                  <span>Setting up yt-dlp (one-time, ~30 MB)…</span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar progress-bar-indeterminate" style={{ width: '40%' }} />
                </div>
              </div>
            )}

            {loading && setupStage !== 'downloading' && (
              <div className="progress-wrap">
                <div className="progress-label">
                  <span>{progress?.title || 'Starting download…'}</span>
                  <span>{progress ? `${Math.round(progress.percent || 0)}%` : ''}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${progress?.percent || 2}%` }} />
                </div>
              </div>
            )}

            {result && (
              <div className={`result-banner ${result.success ? 'success' : 'error'}`}>
                {result.success ? `✓ Downloaded to: ${result.outputDir}` : `✗ ${result.error}`}
              </div>
            )}
          </>
        )}

        {tab === 'advanced' && (
          <div className="advanced-grid">
            <div className="form-group">
              <label className="form-label">Audio-only Format</label>
              <select className="form-select" value={audioFormat} onChange={e => setAudioFormat(e.target.value)}>
                {AFORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Subtitle Language</label>
              <input
                className="form-input"
                value={subsLang}
                onChange={e => setSubsLang(e.target.value)}
                placeholder="en"
                style={{ minWidth: 110 }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Rate Limit</label>
              <input
                className="form-input"
                value={rateLimit}
                onChange={e => setRateLimit(e.target.value)}
                placeholder="e.g. 5M"
                style={{ minWidth: 110 }}
              />
            </div>
            <div className="toggle-row" style={{ gridColumn: '1 / -1' }}>
              <div className="toggle-info">
                <div className="toggle-title">Embed Thumbnail</div>
                <div className="toggle-desc">Adds cover art into the downloaded file</div>
              </div>
              <label className="pixel-toggle">
                <input type="checkbox" checked={embedThumbnail} onChange={e => setEmbedThumbnail(e.target.checked)} />
                <span className="pixel-toggle-track" />
              </label>
            </div>
            <div className="toggle-row" style={{ gridColumn: '1 / -1' }}>
              <div className="toggle-info">
                <div className="toggle-title">Embed Subtitles</div>
                <div className="toggle-desc">Downloads and embeds subtitles in the selected language</div>
              </div>
              <label className="pixel-toggle">
                <input type="checkbox" checked={embedSubs} onChange={e => setEmbedSubs(e.target.checked)} />
                <span className="pixel-toggle-track" />
              </label>
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">
                Browser Cookies
                <span style={{ opacity: 0.5, fontWeight: 400, marginLeft: 8 }}>for X/Twitter, Instagram, or other login-required sites</span>
              </label>
              <select className="form-select" value={cookiesFromBrowser} onChange={e => setCookiesFromBrowser(e.target.value)}>
                <option value="">None (public content only)</option>
                {COOKIE_BROWSERS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                yt-dlp will borrow your session cookies from the selected browser to download login-gated content.
              </div>
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">yt-dlp Engine</label>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 12,
              }}>
                <span style={{ color: 'var(--text-muted)' }}>Version:</span>
                <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
                  {ytDlpVersion || '—'}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={updateYtDlp}
                  disabled={ytDlpUpdating}
                  title="Re-download the latest yt-dlp build (fixes broken extractors)"
                >
                  {ytDlpUpdating ? '⟳ Updating…' : '↑ Update'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                If a site stops working (YouTube, IG, TikTok change often), update yt-dlp first.
              </div>
            </div>
            <div className="adv-note">
              Advanced settings apply to the current session only.<br/>
              Set permanent defaults in ⚙ Settings.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
