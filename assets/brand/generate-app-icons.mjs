// Composes the Burgers Bar app/PWA icon, favicon, and web manifest from the client's
// existing mark — recoloured to the design tokens, never redrawn (ADR-0016).
//
// The source is assets/brand/icon-mark-white.svg: three vector paths — a left bracket,
// a right bracket, and the "B" letterform between them (the "B + brackets" mark). This
// script reads those paths straight from the source so nothing is hand-copied or
// re-drawn; it only recolours (cream on the brand-gradient tile, per the brand tokens)
// and composes them onto tiles at the sizes the platforms need.
//
// Outputs:
//   assets/brand/icon-tile.svg            master brand-gradient tile (kept as SVG source)
//   apps/web/public/favicon.png           the site's own tab icon, copied verbatim
//   apps/web/public/favicon.ico           the same site icon at 16/32/48px
//   apps/web/public/icon-192.png          maskable, safe-zone honoured
//   apps/web/public/icon-512.png          maskable, safe-zone honoured
//   apps/web/public/apple-touch-icon.png  180px apple-touch (iOS applies its own mask)
//   apps/web/public/manifest.webmanifest  name, icons, theme_color, background_color
//
// Run from the repo root with sharp + png-to-ico available (the npx --package one-liner
// does not put them on the ESM path on Node 23):
//   npm install --no-save sharp png-to-ico && node assets/brand/generate-app-icons.mjs
//
// The generated binaries are committed; this script is the record of how they were made.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const brandDir = resolve(repoRoot, 'assets', 'brand')
const publicDir = resolve(repoRoot, 'apps', 'web', 'public')

// --- Tokens (docs/design-system/tokens.md) -------------------------------------------
// App tiles are the signature brand gradient (the site's header sweep) with the mark in
// cream; the favicon is not composed at all — it is the site's own tab icon
// (site-favicon.png, the transparent-background dark mark burgersbar.co.il serves),
// shipped verbatim so the staff app's tab is identical to the site's (owner call 2026-08).
const TAN = '#B99666' // --bb-tan, the gradient's light stop (gradient-only, never a solid fill)
const BROWN = '#5F4A32' // --bb-brown, the one brown — the gradient's dark stop and the chrome tint
const CREAM = '#FEF3E3' // --bb-cream, the mark on the gradient and the light app canvas

// One gradient definition shared by every tile; each svg carries its own copy.
const GRADIENT_DEFS = `<defs>
    <linearGradient id="bb-brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${TAN}" />
      <stop offset="1" stop-color="${BROWN}" />
    </linearGradient>
  </defs>`

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

// One centred cream mark, scaled to `markScale` of the tile width.
function markGroup({ size, markScale, glyph }) {
  const w = markScale * size
  const s = w / MARK_W
  const tx = (size - w) / 2
  const ty = (size - MARK_H * s) / 2
  const paths = glyph.map((d) => `<path d="${d}" fill="${CREAM}" />`).join('')
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})">${paths}</g>`
}

// Compose one square tile: full-bleed brand gradient, cream mark centred at `markScale`.
// Maskable/apple tiles stay square so the OS applies its own mask.
function tile({ size = 512, markScale, glyph = FULL } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${GRADIENT_DEFS}
  <rect width="${size}" height="${size}" fill="url(#bb-brand)" />
  ${markGroup({ size, markScale, glyph })}
</svg>
`
}

// Mark sizing:
//  - maskable: mark within the central 80% safe zone (its half-diagonal stays inside the
//    409.6px safe circle on a 512 tile), so a circular OS mask never clips the mark.
//  - apple: iOS does not mask to a circle (only rounds corners), so the mark runs larger.
const MASKABLE_SCALE = 0.52
const APPLE_SCALE = 0.62

const png = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

async function main() {
  // Master brand tile source (kept as SVG).
  const masterTile = tile({ size: 512, markScale: MASKABLE_SCALE })
  writeFileSync(resolve(brandDir, 'icon-tile.svg'), masterTile)

  // The favicon is the site's own tab icon, copied verbatim (transparent background,
  // dark mark) — identical to burgersbar.co.il's tab by construction.
  const siteFavicon = readFileSync(resolve(brandDir, 'site-favicon.png'))
  writeFileSync(resolve(publicDir, 'favicon.png'), siteFavicon)

  // Maskable PWA icons (192, 512) from the master tile.
  writeFileSync(resolve(publicDir, 'icon-192.png'), await png(masterTile, 192))
  writeFileSync(resolve(publicDir, 'icon-512.png'), await png(masterTile, 512))

  // Apple-touch icon (180), square full-bleed — iOS rounds it itself.
  const appleTile = tile({ size: 512, markScale: APPLE_SCALE })
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

  console.log('composed app icons, favicon, and manifest into apps/web/public')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
