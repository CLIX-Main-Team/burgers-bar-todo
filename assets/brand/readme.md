# Brand assets

The client's existing Burgers Bar mark and wordmark, plus the on-system assets composed
from them. Per ADR-0016 the corporate letterform is **composed and recoloured, never
redrawn** — everything here derives from the two source vectors.

## Source (from the client, #66)

- `icon-mark-white.svg` — the monochrome "B + brackets" mark (left bracket, right bracket,
  and the "B" letterform).
- `logo-wordmark-white.svg` — the monochrome wordmark.
- `app-icon-192.png` — the client's original raster app icon.
- `site-favicon.png` — the tab icon burgersbar.co.il itself serves (252px, transparent
  background, dark mark), fetched 2026-08.

## Composed app-icon set (issue #107)

`icon-tile.svg` is the master app tile — the mark in `--bb-neutral-50` on the
`--bb-neutral-950` dark canvas, so the icon and the screen it opens are the same two
colours, and so the ( B ) still reads at 48px. Every home-screen tile is cut from it:
the PWA `icon-192`/`icon-512`, the `apple-touch-icon` an iPhone uses for Add to Home
Screen, and the Android launcher set below.

The tile was the cream mark on the brand gradient until 2026-08-11. The dark tile started
as an Android-launcher-only owner call that day and was extended to the web icons the same
day, once Add-to-Home-Screen became the iOS delivery route — two different app icons on
two phones in the same pocket was the thing to avoid.

The favicon alone breaks from the tile: it is `site-favicon.png` shipped verbatim (plus
the .ico resized from it), so the staff app's browser tab is identical to the site's own
(owner call 2026-08). Everything in `apps/web/public/` is produced by
`generate-app-icons.mjs`, which reads the mark's paths straight from `icon-mark-white.svg`
so nothing is hand-copied.

## Android launcher icons

The same generator writes the APK's three rasters into
`apps/web/android/app/src/main/res/mipmap-*/` at the five densities:

- `ic_launcher_foreground.png` — the mark alone on transparency, sized to keep its bounding box
  inside the 72dp-of-108dp safe circle; Android composites it over the colour resource below.
- `ic_launcher.png` / `ic_launcher_round.png` — the legacy square and circle for launchers below
  API 26, which composite nothing and so carry the ground themselves.
- `values/ic_launcher_background.xml` — the adaptive icon's ground, written by the generator so
  it cannot drift from the near-black baked into the legacy pair.

Changing the icon takes an APK rebuild to reach a phone; installed apps keep the icon they
shipped with. The web tiles need no rebuild — a deploy is enough, though a phone that has
already installed the web app may keep its old icon until it is re-added.

Regenerate (from the repo root) after changing the source mark or the generator:

```sh
npm install --no-save sharp png-to-ico
node assets/brand/generate-app-icons.mjs
```

(The `npx --package` one-liner stopped resolving ESM imports on Node 23.)

The generated binaries are committed; the script is the record of how they were made.
