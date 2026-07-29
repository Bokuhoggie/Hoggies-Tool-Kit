#!/usr/bin/env node
/**
 * fetch-ffmpeg — download the static ffmpeg/ffprobe binaries HTK bundles.
 *
 * These are NOT committed to git (they're ~45-80 MB each). This script fetches them
 * into src-tauri/resources/ before a dev run or a release build.
 *
 * Every download is verified against a pinned SHA-256 below. A mismatch is a hard
 * failure — we never place an unverified binary that the app will later execute.
 *
 * Source: https://github.com/eugeneware/ffmpeg-static (statically linked, no external
 * dylib dependencies — Homebrew's ffmpeg is NOT usable here, it links 56 libraries out
 * of /opt/homebrew/Cellar and breaks on any machine without an identical setup).
 *
 * On macOS the arm64 and x86_64 builds are merged with `lipo` into a universal binary,
 * matching the universal app bundle.
 *
 *   node scripts/fetch-ffmpeg.mjs            # current platform
 *   node scripts/fetch-ffmpeg.mjs --platform win32
 *   node scripts/fetch-ffmpeg.mjs --force    # re-download even if present
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE = 'b6.1.1'
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`

// Pinned SHA-256 for every asset we fetch. Verified against the GitHub release digests.
// To bump RELEASE, update these too:
//   gh api repos/eugeneware/ffmpeg-static/releases/latest \
//     --jq '.assets[] | "\(.name) \(.digest)"'
const CHECKSUMS = {
  'ffmpeg-darwin-arm64':  'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
  'ffmpeg-darwin-x64':    'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
  'ffprobe-darwin-arm64': 'bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64',
  'ffprobe-darwin-x64':   'fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0',
  'ffmpeg-win32-x64':     '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
  'ffprobe-win32-x64':    '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4',
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESOURCES = join(__dirname, '..', 'src-tauri', 'resources')

const args = process.argv.slice(2)
const force = args.includes('--force')
const platformArg = args[args.indexOf('--platform') + 1]
const platform = args.includes('--platform') ? platformArg : process.platform

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function download(asset) {
  const expected = CHECKSUMS[asset]
  if (!expected) throw new Error(`No pinned checksum for ${asset}`)

  process.stdout.write(`  ↓ ${asset} … `)
  const res = await fetch(`${BASE}/${asset}`, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${asset}`)

  const buf = Buffer.from(await res.arrayBuffer())
  const actual = sha256(buf)
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset}\n  expected ${expected}\n  actual   ${actual}\n` +
      `Refusing to install an unverified binary.`
    )
  }
  console.log(`${(buf.length / 1e6).toFixed(1)} MB ✓ verified`)
  return buf
}

/** Merge per-arch macOS builds into one universal binary. */
function lipo(inputs, output) {
  execFileSync('lipo', ['-create', ...inputs, '-output', output])
  inputs.forEach((p) => rmSync(p, { force: true }))
}

async function buildMac(name) {
  const out = join(RESOURCES, name)
  if (existsSync(out) && !force) {
    console.log(`  = ${name} already present (use --force to refetch)`)
    return
  }
  const arm = join(RESOURCES, `.${name}-arm64`)
  const x64 = join(RESOURCES, `.${name}-x64`)
  writeFileSync(arm, await download(`${name}-darwin-arm64`))
  writeFileSync(x64, await download(`${name}-darwin-x64`))
  lipo([arm, x64], out)
  chmodSync(out, 0o755)
  console.log(`  → ${name} (universal arm64 + x86_64)`)
}

async function buildWin(name) {
  const out = join(RESOURCES, `${name}.exe`)
  if (existsSync(out) && !force) {
    console.log(`  = ${name}.exe already present (use --force to refetch)`)
    return
  }
  writeFileSync(out, await download(`${name}-win32-x64`))
  console.log(`  → ${name}.exe`)
}

async function main() {
  mkdirSync(RESOURCES, { recursive: true })
  console.log(`Fetching ffmpeg ${RELEASE} for ${platform} → src-tauri/resources/`)

  if (platform === 'darwin') {
    await buildMac('ffmpeg')
    await buildMac('ffprobe')
  } else if (platform === 'win32') {
    await buildWin('ffmpeg')
    await buildWin('ffprobe')
  } else {
    console.error(`Unsupported platform: ${platform} (HTK ships macOS and Windows)`)
    process.exit(1)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`)
  process.exit(1)
})
