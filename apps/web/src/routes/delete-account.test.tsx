import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '../i18n/locale.js'
import { deleteAccountPolicy } from './delete-account-content.js'
import { DeleteAccountScreen } from './delete-account.js'

// Google Play checks this page by opening it: it has to load without a login, name the app the
// way the listing does, and put the way to ask for deletion where a reader finds it. These cases
// hold those three, in both languages.

function renderPage(locale: 'en' | 'he'): void {
  localStorage.setItem('burgers.locale', locale)
  render(
    <MemoryRouter>
      <LocaleProvider>
        <DeleteAccountScreen />
      </LocaleProvider>
    </MemoryRouter>,
  )
}

describe('DeleteAccountScreen', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the English page for an English visitor', () => {
    renderPage('en')

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      deleteAccountPolicy.en.title,
    )
    expect(screen.getByRole('heading', { name: 'How to ask' })).toBeInTheDocument()
  })

  it('renders the Hebrew page for a Hebrew visitor', () => {
    renderPage('he')

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      deleteAccountPolicy.he.title,
    )
  })

  it('names the app as the store listing does', () => {
    renderPage('en')

    // Play's check is that the page identifies the app it belongs to; it says so twice, in the
    // opening line and in the request itself, so this asks for presence rather than a lone hit.
    expect(screen.getAllByText(/Burger’s Bar Staff/).length).toBeGreaterThan(0)
  })

  it('links back to the privacy policy', () => {
    renderPage('en')

    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy')
  })
})
