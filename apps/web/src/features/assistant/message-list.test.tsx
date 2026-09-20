import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { MessageList, type Turn } from './message-list.js'

// The typed source chips under an answer (#385): a page the web search cited is a link that opens
// in a new tab, and since 2026-09-18 so is a document, to its file in Drive, with the date it was
// last changed; an app read stays a plain chip, since it has no page to open.

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

// The per-person limit (2026-09-20): a refused question is not a failed one. The notice says to
// wait a moment, and the retry is still there for when the moment has passed.
describe('MessageList when the person is asked to slow down', () => {
  it('shows the slow-down notice with a retry, not the failure notice', () => {
    render(
      <LocaleProvider>
        <MessageList
          turns={[]}
          phase="limited"
          animatingId={null}
          onRetry={() => {}}
          endRef={null}
        />
      </LocaleProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/wait a moment/i)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
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

  it('links a document chip to its file in Drive and shows when it was last changed', () => {
    renderTurns([
      agentTurn([
        {
          id: 'doc-1',
          title: 'Closing the grill',
          type: 'document',
          url: 'https://drive.google.com/file/d/abc/view',
          modifiedAt: '2026-03-11T00:00:00.000Z',
        },
      ]),
    ])
    const link = screen.getByRole('link', { name: /Closing the grill/ })
    expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/abc/view')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    // The test locale is English, so the short date reads month first.
    expect(link).toHaveTextContent('3/11/26')
  })

  it('renders an app source, and a document saved before Drive links, as plain chips', () => {
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

  it('renders a general-knowledge answer with its own quiet chip, not a document one', () => {
    renderTurns([agentTurn([{ id: 'general', title: 'General knowledge', type: 'general' }])])
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('General knowledge')).toBeInTheDocument()
  })
})
