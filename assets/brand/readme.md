# Brand assets

The client's existing Burgers Bar mark and wordmark, plus the on-system assets composed
from them. Per ADR-0016 the corporate letterform is **composed and recoloured, never
redrawn** — everything here derives from the two source vectors.

## Source (from the client, #66)

- `icon-mark-white.svg` — the monochrome "B + brackets" mark (left bracket, right bracket,
  and the "B" letterform).
- `logo-wordmark-white.svg` — the monochrome wordmark.
- `app-icon-192.png` — the client's original raster app icon.

## Composed app-icon set (issue #107)

`icon-tile.svg` is the master gold-hero tile — the ink mark (`--bb-ink-max`) on the
appetite-gold primary (`--bb-gold-400`), ink-on-gold per the `primary` /
`primary-foreground` tokens, never white. It and the wired favicon / PWA / apple-touch
assets in `apps/web/public/` are produced by `generate-app-icons.mjs`, which reads the
mark's paths straight from `icon-mark-white.svg` so nothing is hand-copied.

Regenerate (from the repo root) after changing the source mark or the generator:

```sh
npx --yes --package=sharp --package=png-to-ico node assets/brand/generate-app-icons.mjs
```

The generated binaries are committed; the script is the record of how they were made.
