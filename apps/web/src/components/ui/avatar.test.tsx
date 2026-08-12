import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Avatar, AvatarStack } from './avatar.js'

describe('Avatar — initials', () => {
  it('takes the first letter of a single-word name, uppercased', () => {
    const { container } = render(<Avatar name="dana" />)
    expect(container.textContent).toBe('D')
  })

  it('takes the first letter of the first and last words of a multi-word name', () => {
    const { container } = render(<Avatar name="Noa Cohen" />)
    expect(container.textContent).toBe('NC')
  })

  it('keeps a Hebrew name in its own script', () => {
    const { container } = render(<Avatar name="שרה לוי" />)
    // First grapheme of the first and last words, in order — no Latin transliteration.
    expect(container.textContent).toBe('של')
  })

  it('falls back to a placeholder for an empty name', () => {
    const { container } = render(<Avatar name="  " />)
    expect(container.textContent).toBe('?')
  })
})

describe('AvatarStack', () => {
  it('renders nothing when there are no assignees', () => {
    const { container } = render(<AvatarStack names={[]} label="Assigned to" />)
    expect(container.firstChild).toBeNull()
  })

  it('announces the assignees to assistive tech via an sr-only label', () => {
    const { getByText } = render(<AvatarStack names={['Dana', 'Noa']} label="Assigned to" />)
    expect(getByText('Assigned to Dana, Noa')).toHaveClass('sr-only')
  })

  it('gives each avatar a name bubble for hover and press-and-hold (owner ask 2026-08-12)', () => {
    const { getAllByText } = render(<AvatarStack names={['Dana']} label="Assigned to" />)
    // The name appears once in the sr-only list and once in the CSS-revealed bubble.
    const bubble = getAllByText('Dana').find((el) => el.className.includes('group-hover:block'))
    expect(bubble).toBeDefined()
    expect(bubble?.className).toContain('group-active:block')
  })
})
