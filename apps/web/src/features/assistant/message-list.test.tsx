import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { MessageList, type Turn } from './message-list.js'

// The typed source chips under an answer (#385): a page the web search cited is a link that opens
// in a new tab; a document or an app read stays a plain chip, since neither has a page to open.

function renderTurns(turns: Turn[]): void {
  render(
    <LocaleProvider>
      <MessageList turns={turns} phase="idle" animatingId={null} onRetry={() => {}} endRef={null} />
    </LocaleProvider>,
  )
}

const agentTurn = (sources: Turn['sources']): Turn => ({
  id: 'agent-1',
  role: 'agent',
  content: 'The answer.',
  createdAt: '2026-09-16T08:00:00.000Z',
  sources,
})

describe('MessageList source chips (#385)', () => {
  it('renders a web source as a link to the page, opening in a new tab', () => {
    renderTurns([
      agentTurn([
        {
          id: 'https://www.gov.il/vat',
          title: 'VAT rate',
          type: 'web',
          url: 'https://www.gov.il/vat',
        },
      ]),
    ])
    const link = screen.getByRole('link', { name: /VAT rate/ })
    expect(link).toHaveAttribute('href', 'https://www.gov.il/vat')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('names a web source by its host when the broker gave it no title of its own', () => {
    renderTurns([
      agentTurn([
        {
          id: 'https://example.org/some/page',
          title: 'https://example.org/some/page',
          type: 'web',
          url: 'https://example.org/some/page',
        },
      ]),
    ])
    expect(screen.getByRole('link', { name: /example\.org/ })).toBeInTheDocument()
  })

  it('renders document and app sources as plain chips, never links', () => {
    renderTurns([
      agentTurn([
        { id: 'doc-1', title: 'Closing the grill', type: 'document' },
        { id: 'app:tasks', title: 'My tasks', type: 'app' },
      ]),
    ])
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Closing the grill')).toBeInTheDocument()
    expect(screen.getByText('My tasks')).toBeInTheDocument()
  })
})
