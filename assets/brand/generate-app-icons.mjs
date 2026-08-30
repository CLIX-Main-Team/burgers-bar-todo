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
//   assets/store/play-icon-512.png        the Play Console's store icon, full-bleed, opaque
//   apps/web/public/manifest.webmanifest  name, icons, theme_color, background_color
//   apps/web/android/.../mipmap-*/        the APK's launcher icons, 5 densities
//   apps/web/android/.../ic_launcher_background.xml  the adaptive icon's ground colour
//   apps/web/android/.../drawable*/splash.png        the native launch screen, 11 buckets
//   apps/web/ios/.../Splash.imageset/     the native launch screen, 3 scale slots
//
// Run from the repo root with sharp + png-to-ico available (the npx --package one-liner
// does not put them on the ESM path on Node 23):
//   npm install --no-save sharp png-to-ico && node assets/brand/generate-app-icons.mjs
//
// The generated binaries are committed; this script is the record of how they were made.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const brandDir = resolve(repoRoot, 'assets', 'brand')
const publicDir = resolve(repoRoot, 'apps', 'web', 'public')
const storeDir = resolve(repoRoot, 'assets', 'store')
const androidResDir = resolve(repoRoot, 'apps', 'web', 'android', 'app', 'src', 'main', 'res')
const iosAppIconDir = resolve(
  repoRoot,
  'apps',
  'web',
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'AppIcon.appiconset',
)
const iosSplashDir = resolve(
  repoRoot,
  'apps',
  'web',
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'Splash.imageset',
)

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

// A manifest carries ONE theme_color and one background_color, so they name the theme the app
// actually opens in — dark since 2026-08-27, when the default flipped (keep in sync with
// theme.tsx THEME_COLOR_* and the index.html meta).
const PAPER = '#0C0E11' // --background under .dark, the night canvas — splash canvas
const BOARD = '#0C0E11' // the night canvas the chrome bar sits over — theme_color tint
const GOLD = '#C9A063' // --bb-gold-300, the brand's primary action fill — notification tint

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

// --- Native launch screens -----------------------------------------------------------
// Both platforms ship a stock Capacitor splash (a blue Capacitor logo on white) that every
// cold start flashes until the WebView paints. It is third-party branding on the client's
// app and reads as unfinished in App Review, so the same mark is composed onto the splash
// canvas instead.
//
// Unlike the tiles these are rectangles, and both platforms scale them to fill: iOS
// aspect-fills one square through LaunchScreen.storyboard, Android centre-crops the
// per-orientation bucket. So the mark is sized against the SHORTER side and left centred,
// which keeps it whole on every aspect ratio either platform can hand it.
const SPLASH_SCALE = 0.24

function splashCanvas(width, height) {
  const short = Math.min(width, height)
  const w = SPLASH_SCALE * short
  const s = w / MARK_W
  const tx = (width - w) / 2
  const ty = (height - MARK_H * s) / 2
  const glyph = FULL.map((d) => `<path d="${d}" fill="${NEAR_BLACK}" />`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${PAPER}" />
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})">${glyph}</g>
</svg>
`
}

// Capacitor's splash buckets, read off the template's own rasters so the branded set lands
// at byte-for-byte the same dimensions the storyboard and the drawable folders expect.
// --- Android notification icon -------------------------------------------------------
// The status-bar icon for a push notification (#59). Android does not draw this image — it
// draws its SILHOUETTE: every pixel with any alpha is repainted in the system's colour (or
// the manifest's notification tint), so a launcher tile handed over here comes out as a
// solid white square. The only usable source is the mark alone on full transparency, which
// is what the white master already is.
//
// 24dp square at every density, with the mark inset so it does not touch the edges — the
// status bar crops tight and a mark running to the boundary reads as a blob at 24dp.
const NOTIFY_SCALE = 0.86
const NOTIFY_DENSITIES = [
  ['mdpi', 24],
  ['hdpi', 36],
  ['xhdpi', 48],
  ['xxhdpi', 72],
  ['xxxhdpi', 96],
]

// Fill is irrelevant to the result (Android repaints the silhouette regardless) but white
// keeps the file honest if a human ever opens it.
const notifyIcon = (size = 96) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${markGroup({ size, markScale: NOTIFY_SCALE, glyph: FULL, fill: '#FFFFFF' })}
</svg>
`

const ANDROID_SPLASHES = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
]

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

// iOS rejects an app icon that carries an alpha channel at all — even one that is fully
// opaque — so the iOS tile drops it. Every other output keeps alpha, and the Android
// adaptive foreground is nothing but alpha, so this is the iOS icon's own encoder.
const opaquePng = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).removeAlpha().png({ compressionLevel: 9 }).toBuffer()

// Splashes are rectangles, and the template's own rasters carry no alpha — a launch screen
// composites over nothing, so an alpha channel would only add weight.
const splashPng = (width, height) =>
  sharp(Buffer.from(splashCanvas(width, height)))
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer()

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

  // The Play Console's store icon: 512 square, 32-bit PNG, a required listing field. It is the
  // full-bleed tile rather than the maskable one — Play rounds the corners itself, so the
  // safe-zone padding the PWA icon carries would only render the mark small — and opaque,
  // because a store icon is composited against surfaces we do not choose.
  mkdirSync(storeDir, { recursive: true })
  writeFileSync(resolve(storeDir, 'play-icon-512.png'), await opaquePng(appleTile, 512))

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
    theme_color: BOARD, // the night canvas the app opens on (2026-08-27)
    background_color: PAPER, // splash canvas, same paper
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

  // Android's native launch screen: one raster per orientation bucket, each centre-cropped
  // by the platform, so every bucket is composed at its own aspect rather than resized from
  // a single master (a resized master would squash the mark on the landscape buckets).
  for (const [bucket, width, height] of ANDROID_SPLASHES) {
    const dir = resolve(androidResDir, bucket)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'splash.png'), await splashPng(width, height))
  }

  // Notification icon: one 24dp silhouette per density, plus the colour Android tints it
  // with. Written from the same mark and the same token as everything above, so the icon in
  // the status bar cannot drift from the one on the home screen.
  const notify = notifyIcon()
  for (const [density, px] of NOTIFY_DENSITIES) {
    const dir = resolve(androidResDir, `drawable-${density}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'ic_stat_notify.png'), await png(notify, px))
  }
  writeFileSync(
    resolve(androidResDir, 'values', 'notification_accent.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="notification_accent">${GOLD}</color>\n</resources>\n`,
  )

  // --- iOS app icon and launch screen ----------------------------------------------------
  // apps/web/ios is committed (PR #292), but it stays generated: `cap add ios` recreates it
  // from the Capacitor template on a fresh Mac, and the template's own icon and splash are
  // stock. Hence the guards — this script is the one step that rebrands both, so re-running
  // it straight after `cap add ios` needs nothing dragged into Xcode.
  //
  // Icon: the template ships a single universal 1024 slot already named AppIcon-512@2x.png,
  // and iOS masks the corners itself and never to a circle, so the mark runs at the
  // apple-touch scale rather than the tighter maskable one.
  if (existsSync(iosAppIconDir)) {
    const iosTile = solidTile({ size: 1024, markScale: APPLE_SCALE })
    writeFileSync(resolve(iosAppIconDir, 'AppIcon-512@2x.png'), await opaquePng(iosTile, 1024))
    console.log('composed the app icon into apps/web/ios')
  }

  // Splash: LaunchScreen.storyboard aspect-fills one square image, and Contents.json lists
  // it three times over the 1x/2x/3x slots — so all three files are the same square, exactly
  // as the template ships them.
  if (existsSync(iosSplashDir)) {
    const iosSplash = await splashPng(2732, 2732)
    for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
      writeFileSync(resolve(iosSplashDir, name), iosSplash)
    console.log('composed the launch screen into apps/web/ios')
  }

  console.log('composed app icons, favicon, and manifest into apps/web/public')
  console.log('composed launcher icons and the launch screen into apps/web/android')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
