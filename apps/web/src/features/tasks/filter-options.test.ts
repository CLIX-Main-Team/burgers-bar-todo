import type { Role, UserSummary } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { peopleForFacets, personSurvives, rolesForBranch } from './filter-options.js'
import { ANY_FILTER, BACKLOG_FILTER } from './task-filters.js'

// What the three filters may OFFER once the ones above them are set. The cases worth pinning are
// the ones a naive `user.locationId === branchId` gets wrong: the chain-wide account that belongs
// everywhere, and the choices that have to be released when a narrowing makes them impossible.

const DIZENGOFF = 'bbbbbbbb-0001-4001-8001-bbbbbbbbbbbb'
const ASHDOD = 'bbbbbbbb-0002-4002-8002-bbbbbbbbbbbb'

const user = (id: string, role: Role, locationId: string | null): UserSummary => ({
  id,
  email: `${id}@demo.local`,
  displayName: id,
  role,
  locationId,
  locationName: locationId,
  status: 'active',
  preferredLanguage: 'he',
})

const RONEN = user('ronen', 'admin', null)
const YAEL = user('yael', 'manager', DIZENGOFF)
const NOA = user('noa', 'employee', DIZENGOFF)
const OMRI = user('omri', 'employee', ASHDOD)
const USERS = [RONEN, YAEL, NOA, OMRI]

describe('peopleForFacets', () => {
  it('keeps everyone when neither facet above it is set', () => {
    expect(peopleForFacets(USERS, ANY_FILTER, ANY_FILTER)).toEqual(USERS)
  })

  it('keeps a branch to its own staff, and the chain-wide account with them', () => {
    expect(peopleForFacets(USERS, ASHDOD, ANY_FILTER)).toEqual([RONEN, OMRI])
  })

  it('narrows by both facets at once', () => {
    expect(peopleForFacets(USERS, DIZENGOFF, 'employee')).toEqual([NOA])
  })
})

describe('rolesForBranch', () => {
  it('offers only the roles somebody at that branch holds, widest first', () => {
    expect(rolesForBranch(USERS, DIZENGOFF)).toEqual(['admin', 'manager', 'employee'])
    expect(rolesForBranch(USERS, ASHDOD)).toEqual(['admin', 'employee'])
  })
})

describe('personSurvives', () => {
  it('releases a person the new branch does not employ', () => {
    expect(personSurvives(USERS, 'noa', ASHDOD, ANY_FILTER)).toBe(false)
    expect(personSurvives(USERS, 'noa', DIZENGOFF, ANY_FILTER)).toBe(true)
  })

  it('releases a person the new role excludes', () => {
    expect(personSurvives(USERS, 'yael', ANY_FILTER, 'employee')).toBe(false)
  })

  it('keeps the backlog under a branch but not under a role', () => {
    expect(personSurvives(USERS, BACKLOG_FILTER, ASHDOD, ANY_FILTER)).toBe(true)
    expect(personSurvives(USERS, BACKLOG_FILTER, ANY_FILTER, 'manager')).toBe(false)
  })

  it('leaves an unset person filter alone', () => {
    expect(personSurvives(USERS, ANY_FILTER, ASHDOD, 'manager')).toBe(true)
  })
})
