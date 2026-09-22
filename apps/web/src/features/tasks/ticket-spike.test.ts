import { describe, expect, it } from 'vitest'
import { SPIKE_SLIPS, spikeSlips } from './ticket-spike.js'

// The spike is a picture, but the height of its pile is data, so the dealing is pinned: the pile
// follows the done share, a little progress never rounds away, and unfinished work never draws a
// full pin.

describe('spikeSlips', () => {
  it('piles the done share of the subject, in eighths of the pin', () => {
    expect(spikeSlips(14, 24)).toBe(5)
    expect(spikeSlips(12, 24)).toBe(4)
  })

  it('leaves the spike bare when nothing is done, or there is nothing at all', () => {
    expect(spikeSlips(0, 12)).toBe(0)
    expect(spikeSlips(0, 0)).toBe(0)
  })

  it('keeps one slip for a single finished task on a long subject', () => {
    expect(spikeSlips(1, 200)).toBe(1)
  })

  it('never fills the pin while something is left', () => {
    expect(spikeSlips(99, 100)).toBe(SPIKE_SLIPS - 1)
  })

  it('fills the pin when the subject is finished', () => {
    expect(spikeSlips(30, 30)).toBe(SPIKE_SLIPS)
  })

  it('never draws more slips than there are finished tasks', () => {
    expect(spikeSlips(1, 2)).toBe(1)
    expect(spikeSlips(3, 3)).toBe(3)
  })
})
