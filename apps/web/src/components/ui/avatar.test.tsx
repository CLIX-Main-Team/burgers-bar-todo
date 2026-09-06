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

describe('Avatar — colour', () => {
  it('wears the tone hashed from the name when none is chosen', () => {
    const { container } = render(<Avatar name="Noa Cohen" />)
    const hashed = render(<Avatar name="Noa Cohen" tone={null} />).container
    expect(container.firstElementChild?.className).toMatch(/bg-person-\d/)
    expect(hashed.firstElementChild?.className).toBe(container.firstElementChild?.className)
  })

  it('wears the chosen tone over the hash (Profile page, 2026-09-04)', () => {
    const { container } = render(<Avatar name="Noa Cohen" tone={6} />)
    expect(container.firstElementChild?.className).toContain('bg-person-6')
    expect(container.firstElementChild?.className).toContain('text-person-6-ink')
  })

  it('carries each person’s own tone through the stack', () => {
    const { container } = render(
      <AvatarStack
        people={[
          { displayName: 'Dana', avatarTone: 2 },
          { displayName: 'Noa', avatarTone: null },
        ]}
        label="Assigned to"
      />,
    )
    const discs = [...container.querySelectorAll('[aria-hidden][dir="auto"]')]
    expect(discs[0]?.className).toContain('bg-person-2')
    expect(discs[1]?.className).toMatch(/bg-person-\d/)
  })
})

describe('AvatarStack', () => {
  it('renders nothing when there are no assignees', () => {
    const { container } = render(<AvatarStack people={[]} label="Assigned to" />)
    expect(container.firstChild).toBeNull()
  })

  it('announces the assignees to assistive tech via an sr-only label', () => {
    const { getByText } = render(
      <AvatarStack
        people={[{ displayName: 'Dana' }, { displayName: 'Noa' }]}
        label="Assigned to"
      />,
    )
    expect(getByText('Assigned to Dana, Noa')).toHaveClass('sr-only')
  })

  it('positions the stack so its sr-only label cannot escape into the document', () => {
    // Regression (prod 2026-08-12): sr-only is position:absolute; with no positioned ancestor
    // it anchors to the viewport, escapes the shell's overflow clip, and stretches the page
    // under every below-the-fold card — two scrollbars on desktop, an unpinned tab bar on
    // phones. The stack wrapper must stay positioned.
    const { container } = render(
      <AvatarStack people={[{ displayName: 'Dana' }]} label="Assigned to" />,
    )
    expect((container.firstChild as HTMLElement).className).toContain('relative')
  })

  it('gives each avatar a name bubble for hover and press-and-hold (owner ask 2026-08-12)', () => {
    const { getAllByText } = render(
      <AvatarStack people={[{ displayName: 'Dana' }]} label="Assigned to" />,
    )
    // The name appears once in the sr-only list and once in the CSS-revealed bubble.
    const bubble = getAllByText('Dana').find((el) => el.className.includes('group-hover:block'))
    expect(bubble).toBeDefined()
    expect(bubble?.className).toContain('group-active:block')
  })
})
