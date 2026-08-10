import { describe, expect, it } from 'vitest'
import { cn } from './cn.js'

describe('cn', () => {
  it('keeps a named type-role size alongside a text colour', () => {
    // Regression: without the extended font-size group, tailwind-merge read `text-label`
    // as a text colour and let `text-primary-foreground` delete it — every Button and
    // pill silently fell back to the inherited 16px.
    expect(cn('text-label font-semibold', 'text-primary-foreground')).toBe(
      'text-label font-semibold text-primary-foreground',
    )
  })

  it('still lets a later type-role size win over an earlier one', () => {
    expect(cn('text-caption', 'text-heading-lg')).toBe('text-heading-lg')
  })
})
