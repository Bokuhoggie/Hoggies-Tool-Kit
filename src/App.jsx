import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { ThemeProvider, useTheme } from './contexts/ThemeContext.jsx'
import { getCurrentWindow } from '@tauri-apps/api/window'
import HtkWidget from './components/HtkWidget.jsx'
import Home from './pages/Home.jsx'
import ImageConverter from './pages/ImageConverter.jsx'
import AudioConverter from './pages/AudioConverter.jsx'
import VideoConverter from './pages/VideoConverter.jsx'
import Downloader from './pages/Downloader.jsx'
import StemSeparator from './pages/StemSeparator.jsx'
import PdfTools from './pages/PdfTools.jsx'
import FileHasher from './pages/FileHasher.jsx'
import FileInspector from './pages/FileInspector.jsx'
import Settings from './pages/Settings.jsx'
import { setPendingFile } from './globalDrop.js'
import { getFirstDropPath } from './dropHelpers.js'

// ─── Settings cog ─────────────────────────────────────────────────────────────
function SettingsCog() {
  const navigate = useNavigate()
  const location = useLocation()
  if (location.pathname === '/settings') return null
  return (
    <button className="settings-cog-btn" onClick={() => navigate('/settings')} title="Settings">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style={{ imageRendering: 'pixelated' }}>
        <rect x="10" y="1"  width="4" height="4" fill="#AAAACC"/>
        <rect x="10" y="19" width="4" height="4" fill="#AAAACC"/>
        <rect x="1"  y="10" width="4" height="4" fill="#AAAACC"/>
        <rect x="19" y="10" width="4" height="4" fill="#AAAACC"/>
        <rect x="3"  y="3"  width="4" height="4" fill="#AAAACC"/>
        <rect x="17" y="3"  width="4" height="4" fill="#AAAACC"/>
        <rect x="3"  y="17" width="4" height="4" fill="#AAAACC"/>
        <rect x="17" y="17" width="4" height="4" fill="#AAAACC"/>
        <rect x="6"  y="6"  width="12" height="12" fill="#AAAACC"/>
        <rect x="8"  y="8"  width="8"  height="8"  fill="var(--bg-surface)"/>
        <rect x="10" y="10" width="4"  height="4"  fill="#AAAACC"/>
      </svg>
    </button>
  )
}

// ─── Global drop handler ──────────────────────────────────────────────────────
function handleGlobalDrop(e) {
  const filePath = getFirstDropPath(e)
  if (!filePath) return

  window.dispatchEvent(new CustomEvent('blade-flick', { detail: '/inspector' }))

  setPendingFile(filePath)
  if (!window.location.hash.startsWith('#/inspector')) {
    window.location.hash = '#/inspector'
  }
}

// ─── TRON Light Cycles — bright racing trails on gridlines ───────────────────
// Positions / timings randomized once per theme and cached so re-renders are stable
// (keeps Math.random out of render — react-hooks/purity).
const cycleCache = new Map()
function generateCycles(themeId) {
  if (cycleCache.has(themeId)) return cycleCache.get(themeId)
  const color = themeId === 'clu' ? 'orange' : ''
  const arr = []
  for (let i = 0; i < 5; i++) {
    const row = 60 + (i * 120) + Math.floor(Math.random() * 60)
    arr.push({
      type: i % 2 === 0 ? 'cycle-h' : 'cycle-h2',
      color,
      style: {
        top: `${row}px`,
        animationDuration: `${6 + Math.random() * 8}s`,
        animationDelay: `${-Math.random() * 12}s`,
      },
    })
  }
  for (let i = 0; i < 4; i++) {
    const col = 100 + (i * 250) + Math.floor(Math.random() * 100)
    arr.push({
      type: i % 2 === 0 ? 'cycle-v' : 'cycle-v2',
      color,
      style: {
        left: `${col}px`,
        animationDuration: `${8 + Math.random() * 10}s`,
        animationDelay: `${-Math.random() * 15}s`,
      },
    })
  }
  cycleCache.set(themeId, arr)
  return arr
}

function TronCycles() {
  const { themeId } = useTheme()
  const location = useLocation()
  const isTron = themeId === 'tron' || themeId === 'clu'
  const isHome = location.pathname === '/'

  if (!isTron) return null
  const cycles = generateCycles(themeId)

  return (
    <div className={`tron-cycles ${isHome ? '' : 'tron-cycles-dim'}`}>
      {cycles.map((c, i) => (
        <div key={i} className={`cycle ${c.type} ${c.color}`} style={c.style} />
      ))}
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
    <HashRouter>
      <div
        className="app-shell"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleGlobalDrop}
      >
        <div className="title-bar">
          <span className="title-bar-label">Hoggie's Tool Kit</span>
          <div className="title-bar-controls">
            <button className="title-bar-btn" onClick={() => getCurrentWindow().minimize()} title="Minimize">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="5" width="8" height="1" fill="currentColor"/></svg>
            </button>
            <button className="title-bar-btn" onClick={() => getCurrentWindow().toggleMaximize()} title="Maximize">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
            <button className="title-bar-btn title-bar-btn-close" onClick={() => getCurrentWindow().close()} title="Close">
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.4"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.4"/></svg>
            </button>
          </div>
        </div>

        <main className="main-content">
          <div className="page-scroll">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/image" element={<ImageConverter />} />
              <Route path="/audio" element={<AudioConverter />} />
              <Route path="/video" element={<VideoConverter />} />
              <Route path="/download" element={<Downloader />} />
              <Route path="/stems" element={<StemSeparator />} />
              <Route path="/pdf" element={<PdfTools />} />
              <Route path="/hash" element={<FileHasher />} />
              <Route path="/inspector" element={<FileInspector />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </main>
        <HtkWidget />
        <SettingsCog />
        <TronCycles />
      </div>
    </HashRouter>
    </ThemeProvider>
  )
}
