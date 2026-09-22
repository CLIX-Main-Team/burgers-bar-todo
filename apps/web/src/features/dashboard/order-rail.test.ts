import { describe, expect, it } from 'vitest'
import { ticketTones } from './order-rail.js'

// The order rail's tickets are a picture, but their colours are data, so the dealing is pinned:
// the shares follow the real counts, and a rare late task is never rounded away.

describe('ticketTones', () => {
  it('deals the tickets in proportion to the late and today counts, late at the front', () => {
    expect(ticketTones(88, 33, 12)).toEqual(['late', 'late', 'today', 'open', 'open'])
  })

  it('never hangs more tickets than there are open tasks', () => {
    expect(ticketTones(2, 0, 2)).toEqual(['today', 'today'])
    expect(ticketTones(4, 1, 0)).toEqual(['late', 'open', 'open', 'open'])
  })

  it('keeps one red ticket for a single late task on a long board', () => {
    expect(ticketTones(200, 1, 0)).toEqual(['late', 'open', 'open', 'open', 'open'])
  })

  it('leaves the rail empty when nothing is open', () => {
    expect(ticketTones(0, 0, 0)).toEqual([])
  })

  it('never deals more coloured tickets than the rail holds', () => {
    expect(ticketTones(3, 3, 3)).toEqual(['late', 'late', 'late'])
  })
})
