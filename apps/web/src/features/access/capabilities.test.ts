import { CAPABILITY_KEYS } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { ACCESS_GROUPS } from './capabilities.js'

// The page is drawn from data, and its failure modes are silent: a labelKey that resolves
// in one locale but not the other renders a raw key on screen, and a catalog capability
// missing from the presentation map simply never appears — the owner would have a switch
// the page cannot show.

function resolves(key: string, locale: 'en' | 'he'): boolean {
  const [section = '', name = ''] = key.split('.')
  const tree = messages[locale] as Record<string, Record<string, unknown> | undefined>
  return typeof tree[section]?.[name] === 'string'
}

describe('access presentation map', () => {
  const rows = ACCESS_GROUPS.flatMap((group) => group.rows)

  it('covers every catalog capability exactly once', () => {
    const shown = rows.map((row) => row.key)
    expect([...shown].sort()).toEqual([...CAPABILITY_KEYS].sort())
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('resolves every label and scope key in both locales', () => {
    const keys = [
      ...ACCESS_GROUPS.map((group) => group.labelKey),
      ...rows.flatMap((row) => [row.labelKey, ...Object.values(row.scopeByRole ?? {})]),
    ]
    for (const key of keys) {
      expect(resolves(key, 'en'), `${key} missing in en`).toBe(true)
      expect(resolves(key, 'he'), `${key} missing in he`).toBe(true)
    }
  })
})
