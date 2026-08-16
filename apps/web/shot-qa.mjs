import { chromium } from 'playwright'
const OUT = process.env.SHOT_OUT
const TOKEN = '5ZOgz7t0iLesfN2GVYINjr7SriIapRsT6O7Y69-VM-o'
const SCREENS = [['tasks','/tasks'],['assistant','/assistant'],['knowledge','/knowledge'],['locations','/locations'],['people','/people']]
const CONFIGS = [
  ['p-en-light', { width: 375, height: 812 }, 'light', 'en'],
  ['p-he-dark',  { width: 375, height: 812 }, 'dark',  'he'],
  ['t-en-light', { width: 768, height: 1024 }, 'light', 'en'],
  ['d-he-dark',  { width: 1920, height: 1080 }, 'dark', 'he'],
  ['d-en-light', { width: 1920, height: 1080 }, 'light', 'en'],
]
const browser = await chromium.launch()
for (const [tag, viewport, theme, locale] of CONFIGS) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await page.addInitScript(([t, th, lo]) => {
    localStorage.setItem('burgers.session.token', t)
    localStorage.setItem('burgers.theme', th)
    localStorage.setItem('burgers.locale', lo)
  }, [TOKEN, theme, locale])
  for (const [name, path] of SCREENS) {
    await page.goto('http://localhost:5901' + path)
    await page.waitForTimeout(1300)
    await page.screenshot({ path: `${OUT}/qa-${tag}-${name}.png` })
  }
  await ctx.close()
}
await browser.close()
console.log('done')
