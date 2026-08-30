import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CountBadge } from './count-badge.js'

describe('CountBadge', () => {
  // The bug this component was made for: a counter built from horizontal padding alone came out
  // an oval at one digit. jsdom cannot measure a box, so pin the two utilities that make it
  // square by construction. Losing either one brings the oval straight back.
  it('holds height and minimum width to the same step', () => {
    render(<CountBadge count={3} label="3 steps here are yours" />)
    expect(screen.getByText('3').parentElement).toHaveClass('h-5', 'min-w-5', 'rounded-full')
  })

  // Callers pass spacing and flow classes. Those must never reach the geometry, or one card
  // quietly gets a different counter from the rest of the app.
  it('keeps its shape when a caller adds its own classes', () => {
    render(<CountBadge count={9} label="nine" className="mt-0.5 flex-none" />)
    const disc = screen.getByText('9').parentElement
    expect(disc).toHaveClass('h-5', 'min-w-5', 'mt-0.5', 'flex-none')
  })

  it('reads out a sentence and hides the bare digit', () => {
    render(<CountBadge count={2} label="2 new assignments" />)
    expect(screen.getByText('2')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('2 new assignments')).toHaveClass('sr-only')
  })
})
