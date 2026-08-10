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
//   apps/web/public/favicon.svg           scalable favicon (gradient tile, full mark)
//   apps/web/public/favicon.ico           16px brackets-only + 32/48px full mark
//   apps/web/public/icon-192.png          maskable, safe-zone honoured
//   apps/web/public/icon-512.png          maskable, safe-zone honoured
//   apps/web/public/apple-touch-icon.png  180px apple-touch (iOS applies its own mask)
//   apps/web/public/manifest.webmanifest  name, icons, theme_color, background_color
//
// Run from the repo root with sharp + png-to-ico available, e.g.:
//   npx --yes --package=sharp --package=png-to-ico node assets/brand/generate-app-icons.mjs
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
// cream; the favicon instead mirrors the site's own tab icon — the dark mark on white
// (owner call 2026-08), so the staff app's tab reads exactly like burgersbar.co.il's.
const TAN = '#B99666' // --bb-tan, the gradient's light stop (gradient-only, never a solid fill)
const BROWN = '#5F4A32' // --bb-brown, the one brown — the gradient's dark stop and the chrome tint
const CREAM = '#FEF3E3' // --bb-cream, the mark on the gradient and the light app canvas
const WHITE = '#FFFFFF' // --bb-white, the favicon tile
const BLACK = '#000000' // --bb-black, the favicon mark (the site's own favicon pairing)

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
const BRACKETS_ONLY = [paths[0], paths[1]] // the two brackets, for tiny sizes

// One centred ink mark, scaled to `markScale` of the tile width. `className` tags the
// group so the responsive favicon can show/hide it by CSS.
function markGroup({ size, markScale, glyph, className, ink = CREAM }) {
  const w = markScale * size
  const s = w / MARK_W
  const tx = (size - w) / 2
  const ty = (size - MARK_H * s) / 2
  const cls = className ? ` class="${className}"` : ''
  const paths = glyph.map((d) => `<path d="${d}" fill="${ink}" />`).join('')
  return `<g${cls} transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})">${paths}</g>`
}

// Compose one square tile: full-bleed ground (the brand gradient unless overridden),
// mark centred at `markScale`. `radius` rounds the tile (favicon); maskable/apple tiles
// stay square so the OS applies its mask.
function tile({ size = 512, markScale, glyph = FULL, radius = 0, ground, ink } = {}) {
  const rx = radius ? ` rx="${radius * size}"` : ''
  const fill = ground ?? 'url(#bb-brand)'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${GRADIENT_DEFS}
  <rect width="${size}" height="${size}"${rx} fill="${fill}" />
  ${markGroup({ size, markScale, glyph, ink })}
</svg>
`
}

// Mark sizing:
//  - maskable: mark within the central 80% safe zone (its half-diagonal stays inside the
//    409.6px safe circle on a 512 tile), so a circular OS mask never clips the mark.
//  - apple: iOS does not mask to a circle (only rounds corners), so the mark runs larger.
//  - favicon: a rounded app tile; brackets-only below ~24px where the full mark muddies.
const MASKABLE_SCALE = 0.52
const APPLE_SCALE = 0.62
const FAVICON_SCALE = 0.64
const FAVICON_BRACKETS_SCALE = 0.72
const FAVICON_RADIUS = 0.1875 // ~squircle app-tile rounding
const FAVICON_SWAP = 24 // below this render size the favicon drops to brackets-only

// The scalable SVG favicon — the site's own tab pairing, dark mark on a white tile
// (owner call 2026-08), unlike the gradient app tiles. A browser rasterises it at the
// tab's render size and resolves the media query against that surface, so it honours the
// same "brackets-only below ~24px, full mark above" rule as the .ico (issue #107): the
// full "B + brackets" is the default and shows at >=24px, and a tab-sized (~16px) render
// swaps to the brackets-only glyph where the full mark muddies. A browser that ignores
// the query keeps the full-mark default — the safe degradation, and the raster path
// (.ico) still guarantees 16px.
function faviconSvg({ size = 512 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <style>
    .bb-brackets { display: none; }
    @media (max-width: ${FAVICON_SWAP - 1}px) {
      .bb-full { display: none; }
      .bb-brackets { display: inline; }
    }
  </style>
  <rect width="${size}" height="${size}" rx="${FAVICON_RADIUS * size}" fill="${WHITE}" />
  ${markGroup({ size, markScale: FAVICON_SCALE, glyph: FULL, className: 'bb-full', ink: BLACK })}
  ${markGroup({ size, markScale: FAVICON_BRACKETS_SCALE, glyph: BRACKETS_ONLY, className: 'bb-brackets', ink: BLACK })}
</svg>
`
}

const png = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

async function main() {
  // Master gold-hero tile source (kept as SVG).
  const masterTile = tile({ size: 512, markScale: MASKABLE_SCALE })
  writeFileSync(resolve(brandDir, 'icon-tile.svg'), masterTile)

  // Scalable, size-responsive SVG favicon.
  writeFileSync(resolve(publicDir, 'favicon.svg'), faviconSvg())

  // Maskable PWA icons (192, 512) from the master tile.
  writeFileSync(resolve(publicDir, 'icon-192.png'), await png(masterTile, 192))
  writeFileSync(resolve(publicDir, 'icon-512.png'), await png(masterTile, 512))

  // Apple-touch icon (180), square full-bleed — iOS rounds it itself.
  const appleTile = tile({ size: 512, markScale: APPLE_SCALE })
  writeFileSync(resolve(publicDir, 'apple-touch-icon.png'), await png(appleTile, 180))

  // favicon.ico: the raster fallback, and the guaranteed path for browsers with no SVG
  // favicon. 16px is brackets-only (the full mark muddies when rastered that small); 32
  // and 48px carry the full mark. Rendered from explicit single-glyph tiles so the frame
  // content never depends on how a rasteriser treats the responsive SVG's media query.
  const bracketsTile = tile({
    size: 512,
    markScale: FAVICON_BRACKETS_SCALE,
    glyph: BRACKETS_ONLY,
    radius: FAVICON_RADIUS,
    ground: WHITE,
    ink: BLACK,
  })
  const fullFaviconTile = tile({
    size: 512,
    markScale: FAVICON_SCALE,
    radius: FAVICON_RADIUS,
    ground: WHITE,
    ink: BLACK,
  })
  const ico = await pngToIco([
    await png(bracketsTile, 16),
    await png(fullFaviconTile, 32),
    await png(fullFaviconTile, 48),
  ])
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
