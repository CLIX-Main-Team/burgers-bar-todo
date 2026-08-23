import { expect, test } from '@playwright/test'

// Cheap installability check (issue #107): the head advertises the manifest and icon
// links, and each of those assets actually resolves from the built bundle. It does not
// judge how the tile or favicon look — that legibility call is the DoD visual-review
// gate — only that the wiring is present and the files ship.
test('manifest and icon links are wired and resolve', async ({ page, request }) => {
  await page.goto('/')

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBe('/manifest.webmanifest')

  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBeTruthy()
  const body = await manifest.json()
  // theme_color / background_color come from the tokens. The chrome tint stays the brand
  // black — it is the app's identity on a tile, not a surface that follows the theme — while
  // the splash canvas follows --background, which the v2 palette turned white.
  expect(body.theme_color).toBe('#17140F')
  expect(body.background_color).toBe('#FFFFFF')
  expect(body.icons.map((i: { src: string }) => i.src)).toEqual(
    expect.arrayContaining(['/icon-192.png', '/icon-512.png']),
  )

  // Every icon/apple-touch link in the head points at an asset that resolves.
  const iconHrefs = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((l) => l.getAttribute('href')).filter((h) => h !== null))
  // The tab icon is the site's own favicon PNG served verbatim (owner call 2026-08).
  expect(iconHrefs).toEqual(
    expect.arrayContaining(['/favicon.png', '/favicon.ico', '/apple-touch-icon.png']),
  )
  for (const href of iconHrefs) {
    const res = await request.get(href)
    expect(res.ok(), `${href} should resolve`).toBeTruthy()
  }
})
