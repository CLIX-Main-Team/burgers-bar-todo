import { describe, expect, it } from 'vitest'
import { privacyPolicy } from './privacy-content.js'

// The two language trees are one document, and a store reviewer may read either. A section
// added to one and forgotten in the other is the failure mode worth catching: it would show
// as a policy that describes less in Hebrew than it promises in English.
describe('privacy policy', () => {
  it('describes the same sections in both languages', () => {
    const shape = (locale: 'en' | 'he') =>
      privacyPolicy[locale].sections.map((section) => ({
        paragraphs: section.paragraphs?.length ?? 0,
        bullets: section.bullets?.length ?? 0,
      }))

    expect(shape('he')).toEqual(shape('en'))
  })

  it('names a controller and a contact address in both languages', () => {
    for (const locale of ['en', 'he'] as const) {
      const [responsible] = privacyPolicy[locale].sections
      expect(responsible?.paragraphs?.[0]).toBeTruthy()
    }
  })

  it('leaves no section without content', () => {
    for (const locale of ['en', 'he'] as const) {
      for (const section of privacyPolicy[locale].sections) {
        expect(section.heading).not.toBe('')
        expect((section.paragraphs?.length ?? 0) + (section.bullets?.length ?? 0)).toBeGreaterThan(
          0,
        )
      }
    }
  })
})
