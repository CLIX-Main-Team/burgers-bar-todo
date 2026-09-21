import type { Location } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { branchesOf, headOfficeOf } from './use-locations.js'

// The one filter every branch count and branch ranking reads through (2026-09-21): the head
// office rides GET /locations beside the branches and is never one of them.
const place = (name: string, kind: Location['kind']): Location => ({
  id: `${name}-id`,
  name,
  kind,
  number: null,
  address: null,
  city: null,
  phone: null,
})

describe('branchesOf / headOfficeOf', () => {
  it('splits the list into the branches and the one head office', () => {
    const list = [
      place('Downtown', 'branch'),
      place('HQ', 'headquarters'),
      place('Uptown', 'branch'),
    ]
    expect(branchesOf(list).map((l) => l.name)).toEqual(['Downtown', 'Uptown'])
    expect(headOfficeOf(list)?.name).toBe('HQ')
  })

  it('answers no head office on a list of branches alone', () => {
    expect(headOfficeOf([place('Downtown', 'branch')])).toBeUndefined()
  })
})
