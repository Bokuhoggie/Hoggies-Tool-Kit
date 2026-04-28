export default function Home() {
  return (
    <div className="page-anim" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', opacity: 0.15, pointerEvents: 'none', userSelect: 'none', transform: 'translateY(-40px)' }}>
        <h1 style={{
          fontFamily: "'Press Start 2P', monospace",
          fontSize: '5rem',
          color: 'var(--accent)',
          margin: 0,
          textShadow: '0 0 20px var(--accent)'
        }}>
          HOGGIE'S
          <br/>
          TOOLKIT
        </h1>
      </div>

      <div className="home-footer" style={{ position: 'fixed', bottom: 20, left: 48, right: 48 }}>
        <span>&#9632; 100% LOCAL</span>
        <span>&#9632; NO UPLOADS</span>
        <span>&#9632; FFMPEG + RUST + YT-DLP</span>
        <span className="blink">_</span>
      </div>
    </div>
  )
}
