#!/usr/bin/env node
/**
 * fetch-fonts — refresh the self-hosted webfonts in src/assets/fonts/.
 *
 * Unlike ffmpeg, these files ARE committed: they're ~59 KB total and vendoring them is
 * the whole point — the app must render correctly with no network at launch, which is
 * what the "100% LOCAL / NO UPLOADS" claim on the home screen promises.
 *
 * Run this only when bumping a font version:
 *   npm run fonts:fetch
 *
 * Only the latin subset is pulled. If the UI ever needs extended glyphs, add the
 * relevant subset here and declare it with its own unicode-range in src/index.css.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// A modern UA is required — Google serves legacy .ttf to unrecognised clients.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const FAMILIES = {
  'press-start-2p': 'Press+Start+2P',
  'vt323': 'VT323:wght@400',
  'inter': 'Inter:wght@400;500;600',
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'src', 'assets', 'fonts')

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res
}

async function fetchFamily(slug, query) {
  const css = await (await get(`https://fonts.googleapis.com/css2?family=${query}&display=swap`)).text()

  // Google emits one @font-face per subset. Keep the latin block; it's the one whose
  // unicode-range starts at U+0000-00FF.
  const blocks = css.split('@font-face').filter((b) => b.includes('unicode-range'))
  if (!blocks.length) throw new Error(`No @font-face blocks returned for ${slug}`)
  const block = blocks.find((b) => /unicode-range:\s*U\+0000-00FF/.test(b)) ?? blocks.at(-1)

  const match = block.match(/url\((https:[^)]+\.woff2)\)/)
  if (!match) throw new Error(`No woff2 URL found for ${slug}`)

  const buf = Buffer.from(await (await get(match[1])).arrayBuffer())
  const file = join(OUT_DIR, `${slug}-latin.woff2`)
  writeFileSync(file, buf)
  console.log(`  ${slug}-latin.woff2  ${(buf.length / 1024).toFixed(1)} KB`)
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log('Fetching latin woff2 subsets → src/assets/fonts/')
  for (const [slug, query] of Object.entries(FAMILIES)) {
    await fetchFamily(slug, query)
  }
  console.log('Done. Remember to keep assets/fonts/OFL.txt accurate.')
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`)
  process.exit(1)
})
