import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getFirstDropPath } from '../dropHelpers.js'
import { setPendingFile } from '../globalDrop.js'
import { useTheme } from '../contexts/ThemeContext.jsx'
import logoUoM from '../assets/logos/logo-uofm.png'
import logoMSU from '../assets/logos/logo-msu.png'
import logoNMU from '../assets/logos/logo-nmu.png'
import logoWSU from '../assets/logos/logo-wsu.png'
import logoLions from '../assets/logos/logo-lions.png'
import logoGoff from '../assets/logos/logo-Goff.png'
import logoHTK from '/icon.png'

/* ---- colour helpers for base tinting ---- */
function hexToRgb(hex) {
  const h = hex.replace('#','')
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)]
}
function rgbToHex([r,g,b]) {
  return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')
}
function lighten(hex, amt) { return rgbToHex(hexToRgb(hex).map(c => c + (255 - c) * amt)) }
function darken(hex, amt)  { return rgbToHex(hexToRgb(hex).map(c => c * (1 - amt))) }

/* ============================================================
   PIXEL ART TOOL BLADE SHAPES  (42 × 190 viewBox)
   Pivot is at bottom-center (x: 21, y: 190).
============================================================ */

function BladeSVG({ color, flip, baseColor }) {
  const tipY = 10
  const bladeH = 130
  return (
    <svg width="42" height="190" viewBox="0 0 42 190" fill="none">
      <g transform={flip ? "translate(42, 0) scale(-1, 1)" : undefined}>
        <rect x="16" y={tipY} width="10" height={bladeH} fill={color} opacity="0.95"/>
        <polygon points="16,140 26,140 21,175" fill={color} opacity="0.95"/>

        <rect x="13" y={tipY - 4}  width="16" height="8"  fill={baseColor || '#9090A8'}/>
        <rect x="14" y={tipY - 3}  width="14" height="6"  fill={baseColor ? lighten(baseColor, 0.2) : '#C0C0D0'}/>

        {/* Accents */}
        {[20,34,48,62,76,90,104].map((y,i) => (
          <rect key={i} x="18" y={y} width="3" height="8" fill="rgba(255,255,255,0.18)"/>
        ))}
        <rect x="22" y={tipY} width="3" height={bladeH} fill="rgba(255,255,255,0.14)"/>
      </g>
    </svg>
  )
}

function ScissorsSVG({ color, flip }) {
  return (
    <svg width="42" height="190" viewBox="0 0 42 190" fill="none">
      <g transform={flip ? "translate(42, 0) scale(-1, 1)" : undefined}>
        <rect x="4"  y="8"  width="14" height="14" fill={color} opacity="0.9"/>
        <rect x="2"  y="11" width="6"  height="8"  fill={color} opacity="0.9"/>
        <rect x="4"  y="20" width="14" height="4"  fill={color} opacity="0.9"/>
        <rect x="24" y="8"  width="14" height="14" fill={color} opacity="0.9"/>
        <rect x="34" y="11" width="6"  height="8"  fill={color} opacity="0.9"/>
        <rect x="24" y="20" width="14" height="4"  fill={color} opacity="0.9"/>
        <rect x="16" y="24" width="10" height="6" fill={color} opacity="0.9"/>
        <polygon points="10,30 20,30 16,170" fill={color} opacity="0.88"/>
        <polygon points="22,30 32,30 26,170" fill={color} opacity="0.88"/>
        <rect x="13" y="36" width="2" height="80" fill="rgba(255,255,255,0.2)"/>
        <rect x="27" y="36" width="2" height="80" fill="rgba(255,255,255,0.2)"/>
      </g>
    </svg>
  )
}

function ScrewdriverSVG({ color, flip, baseColor }) {
  const b1 = baseColor || '#9090A8'
  const b2 = baseColor ? lighten(baseColor, 0.2) : '#B8B8CC'
  const b3 = baseColor ? lighten(baseColor, 0.1) : '#A0A0B4'
  const b4 = baseColor ? lighten(baseColor, 0.25) : '#C8C8DC'
  const b5 = baseColor ? darken(baseColor, 0.1) : '#808090'
  return (
    <svg width="42" height="190" viewBox="0 0 42 190" fill="none">
      <g transform={flip ? "translate(42, 0) scale(-1, 1)" : undefined}>
        <rect x="13" y="8"  width="16" height="30" fill={color} opacity="0.92"/>
        {[13,19,25,31].map((y,i) => (
          <rect key={i} x="11" y={y} width="20" height="4" fill="rgba(0,0,0,0.18)"/>
        ))}
        <rect x="12" y="8"  width="18" height="30" fill="none" stroke={color} strokeWidth="1" opacity="0.5"/>
        <rect x="12" y="38" width="18" height="8" fill={b1}/>
        <rect x="13" y="39" width="16" height="6" fill={b2}/>
        <rect x="18" y="46" width="6"  height="112" fill={b3}/>
        <rect x="19" y="46" width="4"  height="112" fill={b4}/>
        <rect x="10" y="155" width="22" height="6"  fill={b5}/>
        <rect x="9"  y="158" width="24" height="4"  fill={b3}/>
      </g>
    </svg>
  )
}

function CanOpenerSVG({ color, flip, baseColor }) {
  return (
    <svg width="42" height="190" viewBox="0 0 42 190" fill="none">
      <g transform={flip ? "translate(42, 0) scale(-1, 1)" : undefined}>
        <rect x="16" y="8"  width="10" height="100" fill={color} opacity="0.92"/>
        <rect x="14" y="6"  width="14" height="6"  fill={baseColor || '#9090A8'}/>
        <rect x="10" y="100" width="22" height="8"  fill={color} opacity="0.92"/>
        <rect x="10" y="108" width="10" height="16" fill={color} opacity="0.92"/>
        <polygon points="10,124 20,124 14,148" fill={color} opacity="0.9"/>
        <rect x="16" y="108" width="4"  height="8"  fill="rgba(0,0,0,0.25)"/>
        {[112,117,122].map((y,i) => (
          <rect key={i} x="10" y={y} width="5" height="3" fill="rgba(0,0,0,0.3)"/>
        ))}
        <rect x="18" y="14" width="3" height="86" fill="rgba(255,255,255,0.18)"/>
      </g>
    </svg>
  )
}

function NailFileSVG({ color, flip, baseColor }) {
  return (
    <svg width="42" height="190" viewBox="0 0 42 190" fill="none">
      <g transform={flip ? "translate(42, 0) scale(-1, 1)" : undefined}>
        <rect x="10" y="20"  width="22" height="120" fill={color} opacity="0.9"/>
        <rect x="8"  y="18"  width="26" height="6"   fill={baseColor || '#9090A8'}/>
        {[28,35,42,49,56,63,70,77,84,91,98,105,112,119,126,133].map((y,i) => (
          <rect key={i} x="10" y={y} width="22" height="4" fill="rgba(0,0,0,0.14)"/>
        ))}
        <rect x="13" y="138" width="16" height="8"  fill={color} opacity="0.9"/>
        <rect x="16" y="144" width="10" height="6"  fill={color} opacity="0.8"/>
        <rect x="18" y="148" width="6"  height="4"  fill={color} opacity="0.6"/>
        <rect x="11" y="20"  width="3"  height="120" fill="rgba(255,255,255,0.14)"/>
      </g>
    </svg>
  )
}

function MagnifyGlassSVG({ color, flip, baseColor }) {
  return (
    <svg width="42" height="190" viewBox="0 0 42 190" fill="none">
      <g transform={flip ? "translate(42, 0) scale(-1, 1)" : undefined}>
        {/* Mounting collar */}
        <rect x="13" y="4" width="16" height="6" fill={baseColor || '#9090A8'}/>
        <rect x="14" y="5" width="14" height="4" fill={baseColor ? lighten(baseColor, 0.2) : '#C0C0D0'}/>
        {/* Handle stick */}
        <rect x="18" y="10" width="6" height="110" fill={color} opacity="0.92"/>
        <rect x="20" y="10" width="3"  height="110" fill="rgba(255,255,255,0.18)"/>
        {/* Lens ring — pixel-art circle */}
        <rect x="9"  y="120" width="24" height="5"  fill={color} opacity="0.95"/>
        <rect x="5"  y="125" width="5"  height="5"  fill={color} opacity="0.95"/>
        <rect x="32" y="125" width="5"  height="5"  fill={color} opacity="0.95"/>
        <rect x="3"  y="130" width="5"  height="26" fill={color} opacity="0.95"/>
        <rect x="34" y="130" width="5"  height="26" fill={color} opacity="0.95"/>
        <rect x="5"  y="156" width="5"  height="5"  fill={color} opacity="0.95"/>
        <rect x="32" y="156" width="5"  height="5"  fill={color} opacity="0.95"/>
        <rect x="9"  y="161" width="24" height="5"  fill={color} opacity="0.95"/>
        {/* Lens interior glow */}
        <rect x="8"  y="125" width="26" height="36" fill={color} opacity="0.06"/>
        {/* Glare */}
        <rect x="8"  y="130" width="7"  height="7"  fill="rgba(255,255,255,0.28)"/>
        <rect x="17" y="122" width="5"  height="4"  fill="rgba(255,255,255,0.18)"/>
      </g>
    </svg>
  )
}

function CleaverSVG({ color, flip, baseColor }) {
  // Chef's cleaver — wide rectangular blade tapering to a point at the bottom corner,
  // with a stout handle. Reads as "knife" but distinct from the slim IMAGE blade.
  return (
    <svg width="42" height="190" viewBox="0 0 42 190" fill="none">
      <g transform={flip ? "translate(42, 0) scale(-1, 1)" : undefined}>
        {/* Wide cleaver blade body */}
        <rect x="6"  y="8"  width="30" height="90" fill={color} opacity="0.95"/>
        {/* Top spine highlight */}
        <rect x="6"  y="8"  width="30" height="4" fill="rgba(255,255,255,0.22)"/>
        {/* Cutting-edge bevel */}
        <rect x="6"  y="92" width="30" height="6" fill="rgba(0,0,0,0.18)"/>
        {/* Tapered tip — corner extends past the blade */}
        <polygon points="6,98 36,98 36,108" fill={color} opacity="0.92"/>
        <polygon points="6,98 6,104 36,104" fill="rgba(0,0,0,0.18)"/>
        {/* Rivet hole detail in blade */}
        <rect x="11" y="20" width="3" height="3" fill="rgba(0,0,0,0.3)"/>
        {/* Bolster — metal collar between blade and handle */}
        <rect x="12" y="108" width="18" height="8" fill={baseColor || '#9090A8'}/>
        <rect x="13" y="109" width="16" height="6" fill={baseColor ? lighten(baseColor, 0.25) : '#C8C8DC'}/>
        {/* Handle */}
        <rect x="14" y="116" width="14" height="56" fill={color} opacity="0.85"/>
        <rect x="15" y="116" width="3"  height="56" fill="rgba(255,255,255,0.18)"/>
        {/* Handle rivets */}
        <rect x="19" y="130" width="4" height="4" fill={baseColor ? darken(baseColor, 0.1) : '#707080'}/>
        <rect x="19" y="150" width="4" height="4" fill={baseColor ? darken(baseColor, 0.1) : '#707080'}/>
        {/* Handle pommel */}
        <rect x="12" y="170" width="18" height="6" fill={baseColor || '#9090A8'}/>
      </g>
    </svg>
  )
}

function CorkscrewSVG({ color, flip, baseColor }) {
  return (
    <svg width="42" height="190" viewBox="0 0 42 190" fill="none">
      <g transform={flip ? "translate(42, 0) scale(-1, 1)" : undefined}>
        {/* Handle cap — polished metal */}
        <rect x="12" y="2" width="20" height="8" rx="1" fill={baseColor || '#A0A0B8'}/>
        <rect x="14" y="3" width="16" height="6" fill={baseColor ? lighten(baseColor, 0.2) : '#C0C0D0'}/>
        <rect x="14" y="3" width="16" height="3" fill="rgba(255,255,255,0.2)"/>

        {/* T-handle crossbar */}
        <rect x="8"  y="10" width="10" height="5" fill={color} opacity="0.95"/>
        <rect x="26" y="10" width="10" height="5" fill={color} opacity="0.95"/>
        <rect x="8"  y="10" width="10" height="2" fill="rgba(255,255,255,0.15)"/>
        <rect x="26" y="10" width="10" height="2" fill="rgba(255,255,255,0.15)"/>
        {/* T-handle knobs */}
        <rect x="6"  y="8"  width="5" height="9" fill={color} opacity="0.85"/>
        <rect x="6"  y="8"  width="2" height="9" fill="rgba(255,255,255,0.12)"/>
        <rect x="33" y="8"  width="5" height="9" fill={color} opacity="0.85"/>
        <rect x="33" y="8"  width="2" height="9" fill="rgba(255,255,255,0.12)"/>

        {/* Central shaft */}
        <rect x="18" y="15" width="6" height="10" fill={color} opacity="0.95"/>
        <rect x="19" y="15" width="2" height="10" fill="rgba(255,255,255,0.18)"/>

        {/* Spiral — right curve 1 */}
        <rect x="24" y="25" width="10" height="4" fill={color} opacity="0.92"/>
        <rect x="30" y="29" width="4"  height="8" fill={color} opacity="0.88"/>
        <rect x="30" y="29" width="2"  height="8" fill="rgba(255,255,255,0.1)"/>

        {/* Spiral — left curve 1 */}
        <rect x="18" y="37" width="16" height="4" fill={color} opacity="0.9"/>
        <rect x="8"  y="41" width="14" height="4" fill={color} opacity="0.88"/>
        <rect x="8"  y="45" width="4"  height="8" fill={color} opacity="0.85"/>
        <rect x="8"  y="45" width="2"  height="8" fill="rgba(255,255,255,0.1)"/>

        {/* Spiral — right curve 2 */}
        <rect x="8"  y="53" width="14" height="4" fill={color} opacity="0.85"/>
        <rect x="22" y="53" width="12" height="4" fill={color} opacity="0.82"/>
        <rect x="30" y="57" width="4"  height="8" fill={color} opacity="0.8"/>
        <rect x="30" y="57" width="2"  height="8" fill="rgba(255,255,255,0.1)"/>

        {/* Spiral — left curve 2 */}
        <rect x="18" y="65" width="16" height="4" fill={color} opacity="0.78"/>
        <rect x="8"  y="69" width="14" height="4" fill={color} opacity="0.75"/>
        <rect x="8"  y="73" width="4"  height="8" fill={color} opacity="0.7"/>
        <rect x="8"  y="73" width="2"  height="8" fill="rgba(255,255,255,0.1)"/>

        {/* Spiral — right curve 3 */}
        <rect x="8"  y="81" width="14" height="4" fill={color} opacity="0.68"/>
        <rect x="22" y="81" width="10" height="4" fill={color} opacity="0.65"/>
        <rect x="28" y="85" width="4"  height="6" fill={color} opacity="0.6"/>

        {/* Spiral — left curve 3 (taper) */}
        <rect x="18" y="91" width="14" height="4" fill={color} opacity="0.55"/>
        <rect x="12" y="95" width="10" height="4" fill={color} opacity="0.48"/>
        <rect x="12" y="99" width="4"  height="6" fill={color} opacity="0.4"/>

        {/* Tip — connects from last left curve downward */}
        <rect x="12" y="105" width="8" height="3" fill={color} opacity="0.35"/>
        <rect x="16" y="108" width="6" height="3" fill={color} opacity="0.3"/>
        <rect x="18" y="111" width="4" height="3" fill={color} opacity="0.22"/>
        <rect x="19" y="114" width="3" height="3" fill={color} opacity="0.15"/>
        <rect x="20" y="117" width="2" height="2" fill={color} opacity="0.1"/>
      </g>
    </svg>
  )
}

/* ============================================================
   COLLEGE / THEME LOGOS  (replaces the swiss cross on handle)
   All render in the cross area: x:86-114, y:24-52
============================================================ */
/* ── College handle logos — centred in the 200×76 handle body ── */
const logoStyle = (src, color) => ({
  width: '100%', height: '100%',
  backgroundColor: color,
  WebkitMaskImage: `url(${src})`, WebkitMaskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center',
  maskImage: `url(${src})`, maskSize: 'contain',
  maskRepeat: 'no-repeat', maskPosition: 'center',
  imageRendering: 'auto',
  filter: 'drop-shadow(0 0 0.5px rgba(0,0,0,0.15))',
})

function LogoMichiganM() {
  return (
    <foreignObject x="64" y="2" width="72" height="72">
      <div style={{
        ...logoStyle(logoUoM, '#FFCB05'),
        clipPath: 'inset(0 0 3% 0)',
        filter: 'drop-shadow(0 0 1px #00274C) drop-shadow(0 0 0.5px #00274C)',
      }} />
    </foreignObject>
  )
}

function LogoSpartanS() {
  return (
    <foreignObject x="70" y="8" width="60" height="60">
      <div style={logoStyle(logoMSU, '#FFFFFF')} />
    </foreignObject>
  )
}

function LogoNMU() {
  return (
    <foreignObject x="64" y="2" width="72" height="72">
      <div style={logoStyle(logoNMU, '#F2A900')} />
    </foreignObject>
  )
}

function LogoWayneW() {
  return (
    <foreignObject x="68" y="6" width="64" height="64">
      <div style={logoStyle(logoWSU, '#CFAA5E')} />
    </foreignObject>
  )
}

function LogoLions() {
  return (
    <foreignObject x="62" y="0" width="76" height="76">
      <div style={logoStyle(logoLions, 'var(--accent-2)')} />
    </foreignObject>
  )
}

const LOGO_IMAGES = {
  uofm:       logoUoM,
  msu:        logoMSU,
  nmu:        logoNMU,
  waynestate: logoWSU,
  lions:      logoLions,
}

const HANDLE_LOGOS = {
  uofm:       LogoMichiganM,
  msu:        LogoSpartanS,
  nmu:        LogoNMU,
  waynestate: LogoWayneW,
  lions:      LogoLions,
}

/* ============================================================
   HORIZONTAL SWISS ARMY KNIFE HANDLE (200x76)
============================================================ */
function KnifeHandleHorizontal({ open, themeId }) {
  const isTron = themeId === 'tron' || themeId === 'clu'
  const isNmu = themeId === 'nmu'
  const isWsu = themeId === 'waynestate'
  const isUofm = themeId === 'uofm'
  // Gold/yellow themed edges for NMU, WSU, UofM
  const goldEdge = isNmu || isWsu || isUofm
  const bolster    = isTron ? '#181818' : goldEdge ? (isUofm ? '#B09518' : isWsu ? '#A08848' : '#8A7028') : '#808090'
  const bolsterLt  = isTron ? '#222222' : goldEdge ? (isUofm ? '#D0B020' : isWsu ? '#B89850' : '#A08830') : '#B0B0C4'
  const bolsterDk  = isTron ? '#0A0A0A' : goldEdge ? (isUofm ? '#8A7510' : isWsu ? '#806830' : '#6A5520') : '#505060'
  const rivetOuter = isTron ? '#181818' : goldEdge ? (isUofm ? '#A08818' : isWsu ? '#907840' : '#7A6425') : '#707080'
  const rivetInner = isTron ? '#222222' : goldEdge ? (isUofm ? '#D0B020' : isWsu ? '#B89850' : '#A08830') : '#A0A0B8'
  const lanyardOut = isTron ? '#181818' : goldEdge ? (isUofm ? '#B09518' : isWsu ? '#A08848' : '#8A7028') : '#808090'
  const lanyardMid = isTron ? '#101010' : goldEdge ? (isUofm ? '#8A7510' : isWsu ? '#806830' : '#6A5520') : '#606070'
  const lanyardIn  = isTron ? '#050505' : goldEdge ? (isUofm ? '#6A5808' : isWsu ? '#605020' : '#504018') : '#2A2A32'
  return (
    <svg width="200" height="76" viewBox="0 0 200 76"
      className={`sk-handle-svg${open ? ' open' : ''}`}
      style={{ display: 'block' }}
    >
      {/* ── Left bolster ── */}
      <rect x="10" y="8" width="12" height="60" fill={bolster}/>
      <rect x="11" y="10" width="10" height="56" fill={bolsterLt}/>
      <rect x="20" y="8" width="4"  height="60" fill={bolsterDk}/>

      {/* ── Main body ── */}
      <rect x="22" y="8" width="156" height="60" fill={isTron ? '#0C0C0C' : 'var(--accent-dim)'}/>
      {/* Top highlight */}
      <rect x="22" y="8" width="156" height="7" fill={isTron ? 'rgba(77,232,255,0.06)' : 'rgba(255,255,255,0.15)'}/>
      {/* Bottom shadow edge */}
      <rect x="22" y="61" width="156" height="7" fill={isTron ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.18)'}/>

      {isTron ? (
        <>
          {/* TRON: very faint circuit traces — dark handle with subtle hints */}
          <rect x="22" y="8" width="156" height="1" fill="var(--accent)" opacity="0.15"/>
          <rect x="22" y="67" width="156" height="1" fill="var(--accent)" opacity="0.1"/>
          <rect x="30" y="28" width="40" height="1" fill="var(--accent)" opacity="0.05"/>
          <rect x="130" y="28" width="40" height="1" fill="var(--accent)" opacity="0.05"/>
          <rect x="30" y="48" width="40" height="1" fill="var(--accent)" opacity="0.05"/>
          <rect x="130" y="48" width="40" height="1" fill="var(--accent)" opacity="0.05"/>
          {[50, 75, 125, 150].map((x, i) => (
            <rect key={i} x={x} y="14" width="1" height="48" fill="var(--accent)" opacity="0.03"/>
          ))}
        </>
      ) : (
        <>
          {/* ── Side scale texture (pixel bumps) vertically ── */}
          {[40,60,80,100,120,140,160].map((x, i) => (
            <rect key={i} x={x} y="8" width="2" height="60" fill="rgba(0,0,0,0.06)"/>
          ))}
        </>
      )}

      {/* ── Center logo (college theme) or default Swiss cross ── */}
      {(() => {
        if (isTron) return null // TRON: no center logo, lean on accents
        const Logo = HANDLE_LOGOS[themeId]
        if (Logo) return <Logo />
        return (
          <foreignObject x="72" y="10" width="56" height="56">
            <div style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              filter: 'drop-shadow(0 0 3px var(--accent))',
            }}>
              {/* Actual icon with wave detail */}
              <img
                src={logoHTK}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
              {/* Color overlay — recolors waves to theme accent, masked to icon shape */}
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'var(--accent)',
                mixBlendMode: 'color',
                WebkitMaskImage: `url(${logoHTK})`,
                WebkitMaskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskImage: `url(${logoHTK})`,
                maskSize: 'contain',
                maskRepeat: 'no-repeat',
                maskPosition: 'center',
                pointerEvents: 'none',
              }} />
            </div>
          </foreignObject>
        )
      })()}

      {/* ── Rivets ── */}
      <rect x="36" y="34" width="8" height="8" fill={rivetOuter}/>
      <rect x="37" y="35" width="4" height="4" fill={rivetInner}/>

      <rect x="156" y="34" width="8" height="8" fill={rivetOuter}/>
      <rect x="157" y="35" width="4" height="4" fill={rivetInner}/>

      {/* ── Right bolster ── */}
      <rect x="174" y="8" width="4"  height="60" fill={bolsterDk}/>
      <rect x="178" y="8" width="12" height="60" fill={bolster}/>
      <rect x="179" y="10" width="10" height="56" fill={bolsterLt}/>

      {/* ── Lanyard loop (far right) ── */}
      <rect x="187" y="28" width="11" height="20" fill={lanyardOut}/>
      <rect x="189" y="30" width="8"  height="16" fill={lanyardMid}/>
      <rect x="191" y="32" width="6"  height="12" fill={lanyardIn}/>

    </svg>
  )
}

/* ============================================================
   TOOL CONFIG (Divided by pivot side)
============================================================ */
const LEFT_TOOLS = [
  { label: 'IMAGE',  route: '/image', color: 'var(--accent-3)', glow: 'var(--glow-cyan)',   Blade: BladeSVG,       angleOpen: -75, angleClosed: 90,  flip: false, flipY: true  },
  { label: 'AUDIO',  route: '/audio', color: 'var(--accent-2)', glow: 'var(--glow-pink)',   Blade: ScissorsSVG,    angleOpen: -55, angleClosed: 90,  flip: false, flipY: true  },
  { label: 'STEMS',  route: '/stems', color: 'var(--accent-2)', glow: 'var(--glow-pink)',   Blade: CleaverSVG,     angleOpen: -35, angleClosed: 90,  flip: false, flipY: true  },
  { label: 'VIDEO',  route: '/video', color: 'var(--accent)',   glow: 'var(--glow-accent)', Blade: ScrewdriverSVG, angleOpen: -15, angleClosed: 90,  flip: false, flipY: false },
]

const RIGHT_TOOLS = [
  { label: 'DOWNLOAD', route: '/download',  color: 'var(--accent-4)', glow: 'var(--glow-accent)', Blade: CanOpenerSVG,    angleOpen: 20, angleClosed: -90, flip: true, flipY: true },
  { label: 'PDF',      route: '/pdf',       color: 'var(--accent-2)', glow: 'var(--glow-pink)',   Blade: NailFileSVG,    angleOpen: 40, angleClosed: -90, flip: true, flipY: true },
  { label: 'HASH',     route: '/hash',      color: 'var(--accent)',   glow: 'var(--glow-accent)', Blade: CorkscrewSVG,   angleOpen: 60, angleClosed: -90, flip: true, flipY: true },
  { label: 'INSPECT',  route: '/inspector', color: 'var(--accent-3)', glow: 'var(--glow-cyan)',   Blade: MagnifyGlassSVG, angleOpen: 80, angleClosed: -90, flip: true, flipY: true },
]

const ALL_TOOLS = [...LEFT_TOOLS, ...RIGHT_TOOLS]

/* ── Busy chop ──
   How far down the blade swings on each chop, as a fraction of the distance from
   fully open back towards folded. Deep enough to read as a chop from across the
   room, short of the handle so it never looks like the knife is closing. */
const CHOP_DEPTH   = 0.45
const CHOP_STRIKE_MS = 90    // blade travelling down — fast, it's a cut
const CHOP_HOLD_MS   = 60    // beat at the bottom
const CHOP_LIFT_MS   = 260   // blade travelling back up — slower, winding up
const CHOP_REST_MS   = 110   // beat at the top before the next one

/* ============================================================
   WIDGET
============================================================ */
export default function HtkWidget() {
  const { themeId } = useTheme()
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(null)
  const [isShaking, setIsShaking] = useState(false)
  const [flickingTool, setFlickingTool] = useState(null)
  const [peekingTool, setPeekingTool] = useState(null)
  const [dragOverWidget, setDragOverWidget] = useState(false)
  const [isWaving, setIsWaving] = useState(false)
  const [waveBlades, setWaveBlades] = useState(new Set())
  // Tool currently doing work — its blade swings out and chops until the job
  // finishes, so the busy tool is obvious even with the knife folded shut. Only
  // that one blade moves; the wave loop animates all of them and means something
  // else entirely.
  const [busyRoute, setBusyRoute] = useState(null)
  const [chopDown, setChopDown] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Listen for blade flick / peek / wave / busy events
  useEffect(() => {
    const handleFlick = (e) => {
      const route = e.detail
      setFlickingTool(route)
      setTimeout(() => setFlickingTool(null), 1200)
    }
    const handlePeek = (e) => setPeekingTool(e.detail)
    const handleWave = (e) => setIsWaving(e.detail)
    const handleBusy = (e) => {
      const detail = e.detail || {}
      // Accept either { route, busy } or just a route string for set / null for clear.
      if (typeof detail === 'string' || detail === null) {
        setBusyRoute(detail || null)
      } else {
        setBusyRoute(detail.busy ? detail.route : null)
      }
    }
    window.addEventListener('blade-flick', handleFlick)
    window.addEventListener('blade-peek', handlePeek)
    window.addEventListener('blade-wave', handleWave)
    window.addEventListener('blade-busy', handleBusy)
    return () => {
      window.removeEventListener('blade-flick', handleFlick)
      window.removeEventListener('blade-peek', handlePeek)
      window.removeEventListener('blade-wave', handleWave)
      window.removeEventListener('blade-busy', handleBusy)
    }
  }, [])

  // Theme change: trigger a brief wave animation
  const prevThemeRef = useState({ id: themeId })[0]
  useEffect(() => {
    if (prevThemeRef.id !== themeId) {
      prevThemeRef.id = themeId
      setIsWaving(true)
      setTimeout(() => setIsWaving(false), 500)
    }
  }, [themeId, prevThemeRef])

  // Wave: choppy slicing pattern — interleaves left/right blades, each pops open briefly
  useEffect(() => {
    if (!isWaving) { setWaveBlades(new Set()); return }
    // Interleaved order: alternates left↔right for a "busy cutting" feel
    const ORDER = [0, 4, 1, 5, 2, 6, 3, 7]
    const INTERVAL = 110  // ms between each blade firing
    const HOLD     = 175  // ms each blade stays open (overlap = 2 blades at once most of the time)
    let step = 0
    const id = setInterval(() => {
      const idx = ORDER[step % ORDER.length]
      setWaveBlades(prev => new Set([...prev, idx]))
      setTimeout(() => setWaveBlades(prev => { const n = new Set(prev); n.delete(idx); return n }), HOLD)
      step++
    }, INTERVAL)
    return () => clearInterval(id)
  }, [isWaving])

  // Chop: while a tool is working, its blade strikes down and lifts back, on repeat.
  // The timing is deliberately asymmetric — a quick strike and a slower recovery reads
  // as chopping, where an even back-and-forth just reads as a wobble.
  useEffect(() => {
    if (!busyRoute) { setChopDown(false); return }
    let timer
    const step = (down) => {
      setChopDown(down)
      timer = setTimeout(() => step(!down), down ? CHOP_STRIKE_MS + CHOP_HOLD_MS : CHOP_LIFT_MS + CHOP_REST_MS)
    }
    step(true)
    return () => clearTimeout(timer)
  }, [busyRoute])

  // Dynamic layout based on route
  const isHome = location.pathname === '/'
  const isSettings = location.pathname === '/settings'

  // Close the knife when navigating to an inner page
  const prevIsHome = useState(isHome)[0]
  useEffect(() => {
    if (!isHome && prevIsHome) {
      // Small delay to let the navigate complete before closing
      const t = setTimeout(() => setOpen(false), 50)
      return () => clearTimeout(t)
    }
  }, [isHome, prevIsHome])

  const goHome = (e) => {
    e.stopPropagation()
    // Trigger shake animation
    setIsShaking(true)
    setTimeout(() => setIsShaking(false), 400)

    if (isHome) {
      setOpen(prev => !prev) // Toggle open state on home screen via click
    } else {
      setOpen(false)
      navigate('/')
    }
  }

  // Pivots in local SVG coords (relative to the 200x76 handle)
  const LEFT_PIVOT_X = 40
  const LEFT_PIVOT_Y = 38
  const RIGHT_PIVOT_X = 160
  const RIGHT_PIVOT_Y = 38
  const BLADE_PIVOT_X = 21   // center of blade width
  const BLADE_PIVOT_Y = 190  // bottom of blade

  const handleWidgetDrop = (e) => {
    e.preventDefault(); e.stopPropagation()
    setDragOverWidget(false)
    const filePath = getFirstDropPath(e)
    if (!filePath) return

    // Prevent immediate hover snap-open on /inspector transition
    window.__skSuppressHover = true
    setTimeout(() => { window.__skSuppressHover = false }, 1500)

    window.dispatchEvent(new CustomEvent('blade-flick', { detail: '/inspector' }))
    setPendingFile(filePath)
    setOpen(false)
    navigate('/inspector')
  }

  return (
    <div
      className={`sk-widget-container ${isHome ? 'sk-size-large' : isSettings ? 'sk-size-medium' : 'sk-size-small'}`}
      onDragOver={(e) => { e.preventDefault(); setDragOverWidget(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOverWidget(false) }}
      onDrop={handleWidgetDrop}
    >
      <div 
        className={`sk-knife-assembly ${isHome ? 'sk-float' : ''}`}
        style={{
          filter: dragOverWidget ? 'drop-shadow(0 0 16px rgba(255, 159, 28, 0.8))' : 'none',
          transform: dragOverWidget ? 'scale(1.05)' : 'none',
          transition: 'all 0.2s ease-out'
        }}
        onMouseEnter={() => { if (!isHome && !window.__skSuppressHover) setOpen(true) }}
        onMouseLeave={() => { if (!isHome) setOpen(false) }}
      >
        {/* Invisible bridge to catch hovers across the fanned blades */}
        <div 
          className="sk-hover-bridge" 
          style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '360px',
            height: '240px',
            pointerEvents: open ? 'auto' : 'none',
            zIndex: 1
          }} 
        />

        {/* ─── BLADES ─── Rendered behind handle context */}
        {ALL_TOOLS.map((tool, i) => {
          const isLeft = i < LEFT_TOOLS.length
          const ToolBlade = tool.Blade
          
          // Determine local anchor point on the handle
          const pivotX = isLeft ? LEFT_PIVOT_X : RIGHT_PIVOT_X
          const pivotY = isLeft ? LEFT_PIVOT_Y : RIGHT_PIVOT_Y
          
          // Offset blade absolute position so its (21, 190) sits on (pivotX, pivotY)
          const leftOffset = pivotX - BLADE_PIVOT_X
          const topOffset = pivotY - BLADE_PIVOT_Y

          const isOpen = open || flickingTool === tool.route
          const isPeeking = peekingTool === tool.route && !isOpen
          const isWaveActive = isWaving && !open && waveBlades.has(i)
          const isBusy = busyRoute === tool.route && !isOpen

          // Wave opens only 40% of the way — a quick chop, not a full fan
          const waveAngle = tool.angleClosed + (tool.angleOpen - tool.angleClosed) * 0.4

          // Chop swings between fully raised and CHOP_DEPTH of the way back down.
          const chopAngle = tool.angleOpen + (tool.angleClosed - tool.angleOpen) * CHOP_DEPTH

          let currentAngle = tool.angleClosed
          if (isOpen) currentAngle = tool.angleOpen
          else if (isBusy) currentAngle = chopDown ? chopAngle : tool.angleOpen
          else if (isWaveActive) currentAngle = waveAngle
          else if (isPeeking) {
             currentAngle = tool.angleClosed + (tool.angleOpen - tool.angleClosed) * 0.4
          }

          return (
            <button
              key={tool.route}
              className={`sk-blade-item ${(isOpen || isPeeking || isWaveActive || isBusy) ? 'open' : ''} ${hovered === tool.route ? 'hovered' : ''}`}
              style={{
                left: `${leftOffset}px`,
                top: `${topOffset}px`,
                transform: `rotate(${currentAngle}deg)`,
                zIndex: (hovered === tool.route || flickingTool === tool.route || isPeeking || isWaveActive || isBusy) ? 15 : 10,
                // Chopping beats waving beats the normal open/close stagger. The strike
                // eases in and the lift eases out, so the blade accelerates into the cut
                // and settles at the top instead of bouncing like the default spring.
                ...(isBusy
                  ? {
                      transition: chopDown
                        ? `transform ${CHOP_STRIKE_MS}ms cubic-bezier(0.45, 0, 0.9, 0.55)`
                        : `transform ${CHOP_LIFT_MS}ms cubic-bezier(0.2, 0.7, 0.4, 1)`,
                      transitionDelay: '0ms',
                    }
                  : isWaving ? { transition: 'transform 75ms cubic-bezier(0.2, 0, 0.6, 1)' } : {
                  transitionDelay: (flickingTool === tool.route || isPeeking)
                    ? '0ms'
                    : (open
                      ? `${isLeft ? i * 60 : (ALL_TOOLS.length - 1 - i) * 60}ms`
                      : `${isLeft ? (LEFT_TOOLS.length - 1 - i) * 50 : (i - LEFT_TOOLS.length) * 50}ms`)
                })
              }}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                setFlickingTool(null)
                navigate(tool.route)
              }}
              onMouseEnter={() => setHovered(tool.route)}
              onMouseLeave={() => setHovered(null)}
              title={tool.label}
            >
              <div 
                className="sk-blade-visual"
                style={{
                  position: 'relative',
                  transform: [
                    tool.flipY ? 'scaleY(-1)' : '',
                    tool.flip ? 'scaleX(-1)' : ''
                  ].filter(Boolean).join(' ') || 'none',
                  filter: (hovered === tool.route || flickingTool === tool.route || isPeeking)
                    ? `drop-shadow(0 0 12px ${themeId === 'lions' ? '#0076B6' : tool.color}) brightness(1.3)`
                    : `drop-shadow(0 0 4px rgba(0,0,0,0.8))`
                }}
              >
                <ToolBlade
                  color={(() => {
                    const r = tool.route
                    if (themeId === 'msu') {
                      // MSU: green tools, white image blade
                      if (r === '/hash' || r === '/audio' || r === '/download' || r === '/pdf') return '#128A50'
                      return '#E0E0E8'
                    }
                    // UofM: image blade yellow
                    if (themeId === 'uofm' && r === '/image') return '#FFCB05'
                    return tool.color
                  })()}
                  flip={tool.flip}
                  isCollege={!!LOGO_IMAGES[themeId]}
                  baseColor={(() => {
                    const r = tool.route
                    // Tron/CLU: dark screwdriver base
                    if ((themeId === 'tron' || themeId === 'clu') && r === '/video') return '#1A1A22'
                    // MSU: lighter green bases
                    if (themeId === 'msu' && (r === '/audio' || r === '/video' || r === '/download' || r === '/pdf' || r === '/inspector')) return '#128A50'
                    // UofM: blue screwdriver base
                    if (themeId === 'uofm' && r === '/video') return '#0E3D6B'
                    // WSU: green screwdriver base
                    if (themeId === 'waynestate' && r === '/video') return '#0C5449'
                    // NMU: green screwdriver base
                    if (themeId === 'nmu' && r === '/video') return '#004D32'
                    return null
                  })()}
                />
                {LOGO_IMAGES[themeId] && tool.Blade === BladeSVG && (
                  <div style={{
                    position: 'absolute',
                    top: (themeId === 'nmu' || themeId === 'msu' || themeId === 'uofm') ? '140px' :
                         themeId === 'waynestate' ? '147px' :
                         themeId === 'lions' ? ((tool.route === '/image') ? '155px' : '85px') : '110px',
                    left: 'calc(50% + 0.35px)',
                    transform: `translateX(-50%) ${tool.flipY ? 'scaleY(-1)' : ''}`,
                    width: (themeId === 'nmu' || themeId === 'lions') ? '56px' : (themeId === 'uofm' || themeId === 'msu') ? '48px' : '38px',
                    height: (themeId === 'nmu' || themeId === 'lions') ? '56px' : (themeId === 'uofm' || themeId === 'msu') ? '48px' : '38px',
                    pointerEvents: 'none',
                    backgroundColor: (themeId === 'lions' && tool.route === '/image') ? 'transparent' : (themeId === 'lions' ? 'var(--accent-2)' : (themeId === 'uofm' && tool.route === '/image') ? '#FFCB05' : (themeId === 'msu' && tool.route === '/image') ? '#128A50' : tool.color),
                    WebkitMaskImage: (themeId === 'lions' && tool.route === '/image') ? 'none' : `url(${LOGO_IMAGES[themeId]})`,
                    WebkitMaskSize: 'contain',
                    WebkitMaskRepeat: 'no-repeat',
                    maskImage: (themeId === 'lions' && tool.route === '/image') ? 'none' : `url(${LOGO_IMAGES[themeId]})`,
                    maskSize: 'contain',
                    maskRepeat: 'no-repeat',
                    backgroundImage: (themeId === 'lions' && tool.route === '/image') ? `url(${logoGoff})` : 'none',
                    backgroundSize: 'contain',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'center',
                    clipPath: 'none',
                    imageRendering: 'auto',
                    filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,0.4))'
                  }} />
                )}
              </div>
              
              {/* Tool tip label */}
              <div 
                className={`sk-blade-tooltip ${hovered === tool.route ? 'visible' : ''}`}
                style={{
                  color: tool.color,
                  borderColor: tool.color,
                  boxShadow: tool.glow
                }}
              >
                {tool.label}
              </div>
            </button>
          )
        })}

        {/* ─── HANDLE ─── Rendered in front */}
        <button
          className={`sk-handle-btn-horizontal ${isShaking ? 'sk-shake' : ''}`}
          onClick={goHome}
          title={isHome ? "Hoggie's Tool Kit" : "Back to Home"}
        >
          <KnifeHandleHorizontal open={open} themeId={themeId} />
        </button>

      </div>
    </div>
  )
}
