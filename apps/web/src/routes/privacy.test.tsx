import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '../i18n/locale.js'
import { privacyPolicy } from './privacy-content.js'
import { PrivacyScreen } from './privacy.js'

// The page a store reviewer opens. It takes no session and no API call, so what is worth
// holding is that it renders the policy of whichever language the visitor arrives in —
// LocaleProvider persists the choice, which is what these two cases set. The router is here
// only because the document links on to the deletion page.

function renderPolicy(locale: 'en' | 'he'): void {
  localStorage.setItem('burgers.locale', locale)
  render(
    <MemoryRouter>
      <LocaleProvider>
        <PrivacyScreen />
      </LocaleProvider>
    </MemoryRouter>,
  )
}

describe('PrivacyScreen', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the English policy for an English visitor', () => {
    renderPolicy('en')

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(privacyPolicy.en.title)
    expect(screen.getByRole('heading', { name: 'Who is responsible' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(
      privacyPolicy.en.sections.length,
    )
  })

  it('renders the Hebrew policy for a Hebrew visitor', () => {
    renderPolicy('he')

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(privacyPolicy.he.title)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(
      privacyPolicy.he.sections.length,
    )
  })

  // Play checks that the deletion pathway is reachable, and a reviewer reaches it from here.
  it('links on to the account deletion page', () => {
    renderPolicy('en')

    expect(screen.getByRole('link', { name: 'How to delete your account' })).toHaveAttribute(
      'href',
      '/delete-account',
    )
  })
})
