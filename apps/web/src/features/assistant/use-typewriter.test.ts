import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTypewriter } from './use-typewriter.js'

// The reveal is decoration over already-known text, never a gate on reading it (#93, ADR-0003): a
// turn that is not the newest — or any environment that opts out of the animation — shows the whole
// answer at once. The animated growth itself is timing-driven and proven in the Playwright lane.

describe('useTypewriter', () => {
  it('returns the whole text immediately when not animating', () => {
    const { result } = renderHook(() => useTypewriter('the full answer', false))
    expect(result.current).toBe('the full answer')
  })

  it('reveals the whole text once animation has run to completion', async () => {
    const { result } = renderHook(() => useTypewriter('short', true))
    // The reveal is time-boxed; poll until it has completed rather than asserting a mid-frame slice.
    await expect.poll(() => result.current, { timeout: 2000 }).toBe('short')
  })
})
