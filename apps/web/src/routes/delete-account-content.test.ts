import { describe, expect, it } from 'vitest'
import { deleteAccountPolicy } from './delete-account-content.js'
import { policyContact } from './privacy-content.js'

// The same parity guard the privacy policy carries: a section added to one language and
// forgotten in the other would show as a page that promises less in Hebrew than in English,
// and Play reads whichever one the reviewer's locale lands on.
describe('account deletion page', () => {
  it('describes the same sections in both languages', () => {
    const shape = (locale: 'en' | 'he') =>
      deleteAccountPolicy[locale].sections.map((section) => ({
        paragraphs: section.paragraphs?.length ?? 0,
        bullets: section.bullets?.length ?? 0,
        link: section.link ? 1 : 0,
      }))

    expect(shape('he')).toEqual(shape('en'))
  })

  it('gives a contact address to send the request to', () => {
    for (const locale of ['en', 'he'] as const) {
      const [howToAsk] = deleteAccountPolicy[locale].sections
      expect(howToAsk?.paragraphs?.[0]).toContain(policyContact[locale].email)
    }
  })

  it('leaves no section without content', () => {
    for (const locale of ['en', 'he'] as const) {
      for (const section of deleteAccountPolicy[locale].sections) {
        expect(section.heading).not.toBe('')
        expect((section.paragraphs?.length ?? 0) + (section.bullets?.length ?? 0)).toBeGreaterThan(
          0,
        )
      }
    }
  })
})
