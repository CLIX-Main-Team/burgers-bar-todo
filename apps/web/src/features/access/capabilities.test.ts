import { CAPABILITY_KEYS, VIEW_SCOPE_CHOICES, VIEW_SCOPE_KEYS } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { ACCESS_PAGES, SCOPE_LABEL_KEY } from './capabilities.js'

// The page is drawn from data, and its failure modes are silent: a labelKey that resolves
// in one locale but not the other renders a raw key on screen, and a catalog capability
// missing from the presentation map simply never appears — the owner would have a switch
// the page cannot show, or a horizon with no way to move it.

function resolves(key: string, locale: 'en' | 'he'): boolean {
  const [section = '', name = ''] = key.split('.')
  const tree = messages[locale] as Record<string, Record<string, unknown> | undefined>
  return typeof tree[section]?.[name] === 'string'
}

describe('access presentation map', () => {
  const controls = ACCESS_PAGES.flatMap((page) => page.controls)

  it('covers every catalog capability exactly once', () => {
    const shown = [
      ...ACCESS_PAGES.map((page) => page.key),
      ...controls.filter((control) => control.kind === 'switch').map((control) => control.key),
    ]
    expect([...shown].sort()).toEqual([...CAPABILITY_KEYS].sort())
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('covers every horizon exactly once', () => {
    const shown = controls.filter((control) => control.kind === 'scope').map((c) => c.key)
    expect([...shown].sort()).toEqual([...VIEW_SCOPE_KEYS].sort())
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('names every choice a horizon offers — an unnamed one renders as a blank option', () => {
    for (const key of VIEW_SCOPE_KEYS) {
      for (const choice of VIEW_SCOPE_CHOICES[key]) {
        const labelKey = SCOPE_LABEL_KEY[key][choice]
        expect(labelKey, `${key}/${choice} has no label`).toBeTruthy()
        expect(resolves(labelKey as string, 'en'), `${key}/${choice} missing in en`).toBe(true)
        expect(resolves(labelKey as string, 'he'), `${key}/${choice} missing in he`).toBe(true)
      }
    }
  })

  it('resolves every label and blurb in both locales', () => {
    const keys = [
      ...ACCESS_PAGES.flatMap((page) => [
        page.labelKey,
        page.blurbKey,
        ...(page.lockedKey ? [page.lockedKey] : []),
      ]),
      ...controls.map((control) => control.labelKey),
    ]
    for (const key of keys) {
      expect(resolves(key, 'en'), `${key} missing in en`).toBe(true)
      expect(resolves(key, 'he'), `${key} missing in he`).toBe(true)
    }
  })
})
