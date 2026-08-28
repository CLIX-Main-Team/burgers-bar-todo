import type { ProjectCandidate } from '@burgers/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { StepOwners, groupCandidates, matchesQuery } from './step-owners.js'

// The step picker. Its whole reason to differ from the task sheet's is SIZE: a chain-wide project
// reaching every manager is forty-six branches' worth of people, where a flat list of first names
// is a haystack. So the two behaviours worth pinning are the ones that appear with the size — the
// grouping and the filter — and the one that must NOT: a short list still reading as the plain
// list the task sheet has.

const HERZLIYA = '11111111-1111-4111-8111-111111111111'
const RAMAT_GAN = '22222222-2222-4222-8222-222222222222'

function person(name: string, locationId: string | null, locationName: string | null) {
  return {
    id: `${name}-id`,
    displayName: name,
    role: locationId ? 'manager' : 'finance_manager',
    locationId,
    locationName,
  } as ProjectCandidate
}

// Enough to cross the grouping threshold, split across two branches plus the branch-less HQ.
function bigCast(): ProjectCandidate[] {
  const herzliya = Array.from({ length: 7 }, (_, i) => person(`Hz ${i}`, HERZLIYA, 'Herzliya'))
  const ramatGan = Array.from({ length: 7 }, (_, i) => person(`Rg ${i}`, RAMAT_GAN, 'Ramat Gan'))
  return [...herzliya, ...ramatGan, person('Dana Finance', null, null)]
}

function renderPicker(candidates: ProjectCandidate[], onToggle = vi.fn()) {
  render(
    <LocaleProvider>
      <StepOwners
        candidates={candidates}
        picked={[]}
        onToggle={onToggle}
        label="Who is on this step"
      />
    </LocaleProvider>,
  )
  return onToggle
}

describe('groupCandidates', () => {
  it('splits by branch and sorts the branches by name', () => {
    const groups = groupCandidates([
      person('Rg 1', RAMAT_GAN, 'Ramat Gan'),
      person('Hz 1', HERZLIYA, 'Herzliya'),
      person('Hz 2', HERZLIYA, 'Herzliya'),
    ])
    expect(groups.map((group) => group.locationName)).toEqual(['Herzliya', 'Ramat Gan'])
    expect(groups[0]?.members).toHaveLength(2)
  })

  // The HQ roles answer to the chain, which is a real answer rather than a missing branch, so they
  // get a group of their own — and it sorts last, after the ones that name a place.
  it('gives the branch-less their own group, last', () => {
    const groups = groupCandidates([
      person('Dana Finance', null, null),
      person('Hz 1', HERZLIYA, 'Herzliya'),
    ])
    expect(groups.map((group) => group.locationName)).toEqual(['Herzliya', null])
  })
})

describe('matchesQuery', () => {
  it('matches anywhere in the name, not only its start', () => {
    expect(matchesQuery('Yael Cohen', 'cohen')).toBe(true)
  })

  it('ignores case and surrounding space', () => {
    expect(matchesQuery('Yael Cohen', '  YAEL ')).toBe(true)
  })

  it('keeps everybody while the field is empty', () => {
    expect(matchesQuery('Yael Cohen', '')).toBe(true)
  })

  it('excludes a name that does not contain the query', () => {
    expect(matchesQuery('Yael Cohen', 'levi')).toBe(false)
  })
})

describe('StepOwners', () => {
  it('rests as an empty seat and opens to the names', () => {
    renderPicker([person('Yael Cohen', HERZLIYA, 'Herzliya')])
    fireEvent.click(screen.getByRole('button', { name: 'Who is on this step' }))
    expect(screen.getByRole('menuitemcheckbox', { name: /Yael Cohen/ })).toBeInTheDocument()
  })

  // A one-branch project must read exactly as the task sheet does: the chrome appears with the
  // size, and drawing a filter over four names would be chrome asking to be ignored.
  it('offers no filter and no headings on a short list', () => {
    renderPicker([
      person('Yael Cohen', HERZLIYA, 'Herzliya'),
      person('Noa Levi', HERZLIYA, 'Herzliya'),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Who is on this step' }))
    expect(screen.queryByLabelText('Find a name')).toBeNull()
    expect(screen.queryByText('Herzliya')).toBeNull()
  })

  it('groups under branch headings once the list is long', () => {
    renderPicker(bigCast())
    fireEvent.click(screen.getByRole('button', { name: 'Who is on this step' }))
    expect(screen.getByText('Herzliya')).toBeInTheDocument()
    expect(screen.getByText('Ramat Gan')).toBeInTheDocument()
    expect(screen.getByText('Chain-wide')).toBeInTheDocument()
  })

  it('narrows the list to what the filter matches', () => {
    renderPicker(bigCast())
    fireEvent.click(screen.getByRole('button', { name: 'Who is on this step' }))
    fireEvent.change(screen.getByLabelText('Find a name'), { target: { value: 'Rg 3' } })

    expect(screen.getByRole('menuitemcheckbox', { name: /Rg 3/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: /Hz 0/ })).toBeNull()
    // A branch with nothing left in it takes its heading with it.
    expect(screen.queryByText('Herzliya')).toBeNull()
  })

  it('says so rather than showing an empty menu when nothing matches', () => {
    renderPicker(bigCast())
    fireEvent.click(screen.getByRole('button', { name: 'Who is on this step' }))
    fireEvent.change(screen.getByLabelText('Find a name'), { target: { value: 'nobody' } })
    expect(screen.getByText('Nobody by that name.')).toBeInTheDocument()
  })

  // A second press before the first write answers would compute its set from the same stale one,
  // so a fast double-toggle used to leave the name ON rather than back off.
  it('ignores a pick while a write is still in flight', () => {
    const onToggle = vi.fn()
    render(
      <LocaleProvider>
        <StepOwners
          candidates={[person('Yael Cohen', HERZLIYA, 'Herzliya')]}
          picked={[]}
          onToggle={onToggle}
          label="Who is on this step"
          busy
        />
      </LocaleProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Who is on this step' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Yael Cohen/ }))
    expect(onToggle).not.toHaveBeenCalled()
  })

  // Several people can own one step, so the menu stays open — picking three should be one trip,
  // not three.
  it('reports a pick without closing the menu', () => {
    const onToggle = renderPicker([person('Yael Cohen', HERZLIYA, 'Herzliya')])
    fireEvent.click(screen.getByRole('button', { name: 'Who is on this step' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Yael Cohen/ }))
    expect(onToggle).toHaveBeenCalledWith('Yael Cohen-id')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
