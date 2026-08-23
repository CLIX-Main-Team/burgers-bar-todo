// The 1024 x 500 feature graphic Google Play shows at the top of the store page. Apple has
// no equivalent, so this is Android-only.
//
// Composed from the brand's own artwork the way the app icons are (ADR-0016): the BURGERSBAR
// wordmark and the ( B ) mark are read straight from assets/brand, never redrawn, and the
// ground is the same near-black the app chrome stands on with the gold gradient as its seam.
// Play crops this graphic differently across surfaces, so everything that has to survive
// sits well inside the middle; the ghost mark is the only thing near an edge.
//
// Run from the repo root:
//   npm install --no-save sharp && node assets/store/generate-feature-graphic.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const brandDir = resolve(here, '..', 'brand')

const WIDTH = 1024
const HEIGHT = 500
const INK = '#17140F'
const GOLD_300 = '#c9a063'
const GOLD_500 = '#8c7449'
const GOLD_700 = '#6c5434'
const PAPER = '#f4f2ec'

// The wordmark ships as white paths on a 376.24 x 45.52 canvas; scaling is a viewBox change,
// so it stays vector all the way to the raster.
const wordmarkSource = readFileSync(resolve(brandDir, 'logo-wordmark-white.svg'), 'utf8')
const wordmarkPaths = wordmarkSource.slice(
  wordmarkSource.indexOf('<g id="Layer_1-2"'),
  wordmarkSource.lastIndexOf('</g>') + 4,
)
const markSource = readFileSync(resolve(brandDir, 'icon-mark-white.svg'), 'utf8')
const markViewBox = markSource.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 100 100'
const markPaths = markSource
  .slice(markSource.indexOf('>', markSource.indexOf('<svg')) + 1)
  .replace('</svg>', '')

const WORDMARK_WIDTH = 470
const WORDMARK_HEIGHT = (WORDMARK_WIDTH * 45.52) / 376.24

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="seam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${GOLD_300}"/>
      <stop offset="55%" stop-color="${GOLD_500}"/>
      <stop offset="100%" stop-color="${GOLD_700}"/>
    </linearGradient>
    <clipPath id="frame"><rect width="${WIDTH}" height="${HEIGHT}"/></clipPath>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="${INK}"/>

  <!-- The ( B ) at architectural scale, ghosted, bleeding off the trailing edge — the same
       flourish the sign-in panel uses. -->
  <g clip-path="url(#frame)" opacity="0.12">
    <svg x="678" y="85" width="330" height="330" viewBox="${markViewBox}" fill="${GOLD_300}">
      ${markPaths}
    </svg>
  </g>

  <g transform="translate(72, 186)">
    <svg width="${WORDMARK_WIDTH}" height="${WORDMARK_HEIGHT}" viewBox="0 0 376.24 45.52">
      ${wordmarkPaths}
    </svg>
  </g>

  <text x="72" y="300" font-family="Heebo, Arial, sans-serif" font-size="27" fill="${PAPER}" opacity="0.72">
    Every shift, on the same page.
  </text>
  <!-- No direction="rtl" here: that would anchor x at the line's right edge and run the
       Hebrew off the leading edge of the canvas. Bidi orders the glyphs correctly on its own. -->
  <text x="72" y="345" font-family="Heebo, Arial, sans-serif" font-size="27" fill="${PAPER}" opacity="0.72">
    כל משמרת, באותו מקום.
  </text>

  <rect x="72" y="392" width="96" height="5" rx="2.5" fill="url(#seam)"/>
  <rect x="0" y="${HEIGHT - 6}" width="${WIDTH}" height="6" fill="url(#seam)"/>
</svg>`

const out = resolve(here, 'feature-graphic-1024x500.png')
const png = await sharp(Buffer.from(svg)).png().toBuffer()
writeFileSync(out, png)
console.log(`Wrote ${out}`)
