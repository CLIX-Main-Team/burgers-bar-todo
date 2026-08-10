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

`icon-tile.svg` is the master app tile — the cream mark (`--bb-cream`) on the signature
brand gradient (tan → brown, the site's header sweep). The favicon alone breaks from the
tile: it is `site-favicon.png` shipped verbatim (plus the .ico resized from it), so the
staff app's browser tab is identical to the site's own (owner call 2026-08). Everything
in `apps/web/public/` is produced by `generate-app-icons.mjs`, which reads the mark's
paths straight from `icon-mark-white.svg` so nothing is hand-copied.

Regenerate (from the repo root) after changing the source mark or the generator:

```sh
npm install --no-save sharp png-to-ico
node assets/brand/generate-app-icons.mjs
```

(The `npx --package` one-liner stopped resolving ESM imports on Node 23.)

The generated binaries are committed; the script is the record of how they were made.
