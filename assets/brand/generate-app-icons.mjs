// Composes the Burgers Bar app/PWA icon, favicon, and web manifest from the client's
// existing mark — recoloured to the design tokens, never redrawn (ADR-0016).
//
// The source is assets/brand/icon-mark-white.svg: three vector paths — a left bracket,
// a right bracket, and the "B" letterform between them (the "B + brackets" mark). This
// script reads those paths straight from the source so nothing is hand-copied or
// re-drawn; it only recolours (dark-mode ink on the near-black tile, per the brand
// tokens) and composes them onto tiles at the sizes the platforms need.
//
// Outputs:
//   assets/brand/icon-tile.svg            master near-black app tile (kept as SVG source)
//   apps/web/public/favicon.png           the site's own tab icon, copied verbatim
//   apps/web/public/favicon.ico           the same site icon at 16/32/48px
//   apps/web/public/icon-192.png          maskable, safe-zone honoured
//   apps/web/public/icon-512.png          maskable, safe-zone honoured
//   apps/web/public/apple-touch-icon.png  180px apple-touch (iOS applies its own mask)
//   apps/web/public/manifest.webmanifest  name, icons, theme_color, background_color
//   apps/web/android/.../mipmap-*/        the APK's launcher icons, 5 densities
//   apps/web/android/.../ic_launcher_background.xml  the adaptive icon's ground colour
//
// Run from the repo root with sharp + png-to-ico available (the npx --package one-liner
// does not put them on the ESM path on Node 23):
//   npm install --no-save sharp png-to-ico && node assets/brand/generate-app-icons.mjs
//
// The generated binaries are committed; this script is the record of how they were made.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const brandDir = resolve(repoRoot, 'assets', 'brand')
const publicDir = resolve(repoRoot, 'apps', 'web', 'public')
const androidResDir = resolve(repoRoot, 'apps', 'web', 'android', 'app', 'src', 'main', 'res')

// --- Tokens (docs/design-system/tokens.md) -------------------------------------------
// Every app tile — Android launcher, PWA, apple-touch — is the app's own dark canvas
// carrying the mark in the app's own dark-mode ink, so the icon you tap and the screen it
// opens are the same two colours (owner call 2026-08-11, extended from the Android
// launcher to the web tiles 2026-08-11 once the PWA became the iOS delivery route). It
// also survives the small sizes a two-stop gradient behind a thin letterform does not.
// The favicon is not composed at all — it is the site's own tab icon (site-favicon.png,
// the transparent-background dark mark burgersbar.co.il serves), shipped verbatim so the
// staff app's tab is identical to the site's (owner call 2026-08).
const NEAR_BLACK = '#151412' // --bb-neutral-950, the dark canvas
const INK = '#F7F7F5' // --bb-neutral-50, the ink the dark shell paints the mark in

// Chrome and splash still wear the brand: the gradient cannot tint either, so both take
// the gradient's dark stop and the brand cream respectively.
const BROWN = '#5F4A32' // --bb-brown, the one brown — the gradient's dark stop and the chrome tint
const CREAM = '#FEF3E3' // --bb-cream, the manifest's splash canvas

// --- Read the mark, compose-not-redraw (ADR-0016) ------------------------------------
const markSvg = readFileSync(resolve(brandDir, 'icon-mark-white.svg'), 'utf8')
const viewBox = markSvg
  .match(/viewBox="([^"]+)"/)[1]
  .split(/\s+/)
  .map(Number)
const [, , MARK_W, MARK_H] = viewBox // 0 0 41.69 34.52

// Path order in the source: [0] left bracket, [1] right bracket, [2] the "B".
const paths = [...markSvg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1])
if (paths.length !== 3) throw new Error(`expected 3 mark paths, found ${paths.length}`)
const FULL = paths // B + brackets

// One centred mark, scaled to `markScale` of the tile width.
function markGroup({ size, markScale, glyph, fill = INK }) {
  const w = markScale * size
  const s = w / MARK_W
  const tx = (size - w) / 2
  const ty = (size - MARK_H * s) / 2
  const paths = glyph.map((d) => `<path d="${d}" fill="${fill}" />`).join('')
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})">${paths}</g>`
}

// Mark sizing on the web tiles:
//  - maskable: mark within the central 80% safe zone (its half-diagonal stays inside the
//    409.6px safe circle on a 512 tile), so a circular OS mask never clips the mark.
//  - apple: iOS does not mask to a circle (only rounds corners), so the mark runs larger.
const MASKABLE_SCALE = 0.52
const APPLE_SCALE = 0.62

// --- Android launcher tiles ----------------------------------------------------------
// An adaptive icon is a 108dp canvas of which only the central 72dp is guaranteed to
// survive the launcher's mask, so the foreground mark is sized to keep its whole bounding
// box inside that 72dp circle (at 0.48 the half-diagonal is ~33.6dp against a 36dp radius).
// The legacy rasters are not masked that way — a launcher old enough to use them shows the
// square or its own circle — so the mark runs larger there.
const ADAPTIVE_SCALE = 0.48
const LEGACY_SCALE = 0.58

// mipmap density → [legacy icon px, adaptive foreground px]
const ANDROID_DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]

// The one tile every icon is cut from: the near-black square with the mark in dark-mode
// ink. `round` exists because Android's legacy round raster has to carry its own circle —
// nothing masks that one for us.
function solidTile({ size = 512, markScale, ground = NEAR_BLACK, fill = INK, round = false }) {
  const half = size / 2
  const shape = round
    ? `<circle cx="${half}" cy="${half}" r="${half}" fill="${ground}" />`
    : `<rect width="${size}" height="${size}" fill="${ground}" />`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${shape}
  ${markGroup({ size, markScale, glyph: FULL, fill })}
</svg>
`
}

// The adaptive foreground layer is the mark alone on transparency — Android composites it
// over the background colour resource, so baking the ground in here would double it up.
function adaptiveForeground(size = 512) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${markGroup({ size, markScale: ADAPTIVE_SCALE, glyph: FULL, fill: INK })}
</svg>
`
}

const png = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

async function main() {
  // Master app tile source (kept as SVG).
  const masterTile = solidTile({ size: 512, markScale: MASKABLE_SCALE })
  writeFileSync(resolve(brandDir, 'icon-tile.svg'), masterTile)

  // The favicon is the site's own tab icon, copied verbatim (transparent background,
  // dark mark) — identical to burgersbar.co.il's tab by construction.
  const siteFavicon = readFileSync(resolve(brandDir, 'site-favicon.png'))
  writeFileSync(resolve(publicDir, 'favicon.png'), siteFavicon)

  // Maskable PWA icons (192, 512) from the master tile — the home-screen tile an installed
  // web app wears, on Android and on iOS alike.
  writeFileSync(resolve(publicDir, 'icon-192.png'), await png(masterTile, 192))
  writeFileSync(resolve(publicDir, 'icon-512.png'), await png(masterTile, 512))

  // Apple-touch icon (180), square full-bleed — iOS rounds it itself. This is the tile an
  // iPhone shows for an Add-to-Home-Screen install, i.e. the whole iOS delivery route.
  const appleTile = solidTile({ size: 512, markScale: APPLE_SCALE })
  writeFileSync(resolve(publicDir, 'apple-touch-icon.png'), await png(appleTile, 180))

  // favicon.ico: the raster fallback for legacy browsers — the same site icon, resized
  // with its transparency intact.
  const icoFrame = (size) =>
    sharp(siteFavicon).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  const ico = await pngToIco([await icoFrame(16), await icoFrame(32), await icoFrame(48)])
  writeFileSync(resolve(publicDir, 'favicon.ico'), ico)

  // Web manifest, drawn from the tokens.
  const manifest = {
    name: 'Burgers Bar',
    short_name: 'Burgers Bar',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: BROWN, // --bb-brown, the chrome tint (a gradient can't tint chrome)
    background_color: CREAM, // --bb-cream canvas
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }
  writeFileSync(
    resolve(publicDir, 'manifest.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  // --- Android launcher set ----------------------------------------------------------
  // Three rasters per density: the adaptive foreground (mark on transparency), and the
  // legacy square and round tiles for launchers below API 26, which composite nothing.
  const legacySquare = solidTile({ markScale: LEGACY_SCALE })
  const legacyRound = solidTile({ markScale: LEGACY_SCALE, round: true })
  const foreground = adaptiveForeground()

  for (const [density, legacyPx, foregroundPx] of ANDROID_DENSITIES) {
    const dir = resolve(androidResDir, `mipmap-${density}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'ic_launcher.png'), await png(legacySquare, legacyPx))
    writeFileSync(resolve(dir, 'ic_launcher_round.png'), await png(legacyRound, legacyPx))
    writeFileSync(resolve(dir, 'ic_launcher_foreground.png'), await png(foreground, foregroundPx))
  }

  // The adaptive icon's ground is a colour resource, not part of any raster — written here
  // so it cannot drift from the near-black baked into the legacy tiles above.
  writeFileSync(
    resolve(androidResDir, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${NEAR_BLACK}</color>\n</resources>\n`,
  )

  console.log('composed app icons, favicon, and manifest into apps/web/public')
  console.log('composed launcher icons into apps/web/android')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
