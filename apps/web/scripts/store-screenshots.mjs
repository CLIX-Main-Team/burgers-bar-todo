// Shoots the phone screenshots both store listings need, from the deployed app rather than
// a mock: what a reviewer sees on the page is what the app really looks like.
//
// Sizes are the ones each store asks for. Apple wants one 6.9" iPhone set at 1320 x 2868 and
// scales it down to every smaller iPhone; Play wants portrait shots at least 1080 wide, so
// 1080 x 2400 is a stock tall-phone frame. Both come from a real viewport at deviceScaleFactor
// 3, so the type is rendered at phone density instead of an upscaled desktop screenshot.
//
// Credentials come from the environment and are never written here:
//   STORE_SHOT_EMAIL=… STORE_SHOT_PASSWORD=… node apps/web/scripts/store-screenshots.mjs
//
// Optional: STORE_SHOT_ORIGIN to point at somewhere other than production.
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ORIGIN = process.env.STORE_SHOT_ORIGIN ?? 'https://burgers-bar-todo.vercel.app'
const EMAIL = process.env.STORE_SHOT_EMAIL
const PASSWORD = process.env.STORE_SHOT_PASSWORD

if (!EMAIL || !PASSWORD) {
  console.error('Set STORE_SHOT_EMAIL and STORE_SHOT_PASSWORD.')
  process.exit(1)
}

const outRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'assets',
  'store',
  'screenshots',
)

const FRAMES = [
  { name: 'ios-6.9', width: 440, height: 956, scale: 3 },
  { name: 'android', width: 360, height: 800, scale: 3 },
]

// Hebrew is the staff's own language and the one the listing leads with; the English set
// exists because the App Store shows a localized listing per language.
const LOCALES = ['he', 'en']

// The seeded conversation to open for the assistant shot, per locale — the assistant answers
// in the language it was asked in, and a Hebrew thread under an English listing reads wrong.
const DEMO_THREAD = {
  he: 'מה נוהל בדיקת טמפרטורת המקררים?',
  en: 'What is the fridge temperature check?',
}

const SHOTS = [
  { file: '1-board', path: '/tasks', theme: 'light' },
  { file: '2-assistant', path: '/assistant', theme: 'light', openThread: true },
  { file: '3-board-night', path: '/tasks', theme: 'dark' },
]

async function shoot(browser, frame, locale) {
  const context = await browser.newContext({
    viewport: { width: frame.width, height: frame.height },
    deviceScaleFactor: frame.scale,
    isMobile: true,
    hasTouch: true,
    locale: locale === 'he' ? 'he-IL' : 'en-US',
  })
  const page = await context.newPage()

  await page.goto(`${ORIGIN}/login`)
  await page.evaluate((l) => localStorage.setItem('burgers.locale', l), locale)
  await page.reload()

  await page.locator('input[type="email"]').fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/tasks/, { timeout: 30_000 })

  for (const shot of SHOTS) {
    await page.evaluate((t) => localStorage.setItem('burgers.theme', t), shot.theme)
    await page.goto(`${ORIGIN}${shot.path}`)
    // The board and the thread list both land after their first fetch resolves; without this
    // the shot catches an empty frame that looks like an app with nothing in it.
    await page.waitForLoadState('networkidle')
    if (shot.openThread) {
      // A fresh browser has no last-opened thread, so the assistant would photograph its
      // empty state. Open the history and pick the seeded conversation by its title.
      await page
        .getByRole('button', { name: locale === 'he' ? 'השיחות שלכם' : 'Your conversations' })
        .click()
      await page.getByText(DEMO_THREAD[locale], { exact: false }).first().click()
      await page.waitForLoadState('networkidle')
    }
    const dir = join(outRoot, frame.name, locale)
    mkdirSync(dir, { recursive: true })
    await page.screenshot({ path: join(dir, `${shot.file}.png`) })
    console.log(`${frame.name}/${locale}/${shot.file}.png`)
  }

  await context.close()
}

const browser = await chromium.launch()
for (const frame of FRAMES) {
  for (const locale of LOCALES) {
    await shoot(browser, frame, locale)
  }
}
await browser.close()
