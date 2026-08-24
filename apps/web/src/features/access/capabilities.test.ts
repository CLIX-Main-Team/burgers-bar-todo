import { describe, expect, it } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { ACCESS_GROUPS, ROLE_ORDER } from './capabilities.js'

// The matrix is data, and its two failure modes are silent: a labelKey that resolves in one
// locale but not the other renders a raw key on screen, and a scoped cell without a label
// would print a bare tick that hides its scope — the one fact the page exists to show.

function resolves(key: string, locale: 'en' | 'he'): boolean {
  const [section = '', name = ''] = key.split('.')
  const tree = messages[locale] as Record<string, Record<string, unknown> | undefined>
  return typeof tree[section]?.[name] === 'string'
}

describe('access capabilities', () => {
  const allKeys = ACCESS_GROUPS.flatMap((group) => [
    group.labelKey,
    ...group.rows.flatMap((row) => [
      row.labelKey,
      ...ROLE_ORDER.map((role) => row.byRole[role].labelKey).filter(
        (key): key is string => key !== undefined,
      ),
    ]),
  ])

  it('resolves every label key in both locales', () => {
    for (const key of allKeys) {
      expect(resolves(key, 'en'), `${key} missing in en`).toBe(true)
      expect(resolves(key, 'he'), `${key} missing in he`).toBe(true)
    }
  })

  it('names a scope on every scoped cell', () => {
    for (const group of ACCESS_GROUPS) {
      for (const row of group.rows) {
        for (const role of ROLE_ORDER) {
          const level = row.byRole[role]
          if (level.tier === 'scoped') {
            expect(level.labelKey, `${row.key}/${role} scoped without a label`).toBeDefined()
          }
        }
      }
    }
  })
})
