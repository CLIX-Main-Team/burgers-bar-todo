import type { ThreadMessage } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { turnsFromMessages } from './thread-history.js'

// A reopened thread reads the way the live surface did (#94): the create-then-answer doubling of the
// opening question is collapsed, and nothing else is touched.

const STAMP = '2026-01-01T00:00:00.000Z'
const user = (id: string, content: string): ThreadMessage => ({
  id,
  role: 'user',
  content,
  createdAt: STAMP,
})
const agent = (id: string, content: string): ThreadMessage => ({
  id,
  role: 'agent',
  content,
  createdAt: STAMP,
})

describe('turnsFromMessages', () => {
  it('collapses the doubled opening question a created-then-answered thread persists', () => {
    // The first thread's history: create wrote the question (#90), then the answer path wrote it
    // again plus the reply (#91). The reader should see the question once.
    const turns = turnsFromMessages([
      user('m-create', 'How do I open?'),
      user('m-user', 'How do I open?'),
      agent('m-agent', 'Wash your hands first.'),
    ])
    expect(turns).toEqual([
      { id: 'm-user', role: 'user', content: 'How do I open?' },
      { id: 'm-agent', role: 'agent', content: 'Wash your hands first.' },
    ])
  })

  it('keeps an ordinary alternating history untouched', () => {
    const messages = [
      user('m1', 'first'),
      agent('m2', 'answer one'),
      user('m3', 'second'),
      agent('m4', 'answer two'),
    ]
    expect(turnsFromMessages(messages)).toEqual(
      messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
    )
  })

  it('does not swallow a genuinely repeated question asked after a reply', () => {
    // Two identical questions are fine as long as an answer sits between them — that is an
    // alternating history, not the create-doubling signature.
    const messages = [
      user('m1', 'same question'),
      agent('m2', 'an answer'),
      user('m3', 'same question'),
      agent('m4', 'another answer'),
    ]
    expect(turnsFromMessages(messages)).toHaveLength(4)
  })

  it('carries an agent turn’s grounding sources through on reopen (#227)', () => {
    // A reopened doc-grounded answer must show the same attribution chips the live surface did, so
    // the sources ride through the mapping; a user turn and a source-less answer carry none.
    const grounded: ThreadMessage = {
      id: 'm-agent',
      role: 'agent',
      content: 'Turn off the gas valve.',
      createdAt: STAMP,
      sources: [{ id: 'doc-grill', title: 'Closing the grill' }],
    }
    const turns = turnsFromMessages([user('m-user', 'How do I close the grill?'), grounded])
    expect(turns[1]?.sources).toEqual([{ id: 'doc-grill', title: 'Closing the grill' }])
    expect(turns[0]?.sources).toBeUndefined()
  })

  it('leaves a lone opening question in place when no answer was persisted', () => {
    // A thread whose first answer never persisted (a 503 hiccup) is a single user turn — nothing to
    // collapse.
    const turns = turnsFromMessages([user('m-create', 'unanswered')])
    expect(turns).toEqual([{ id: 'm-create', role: 'user', content: 'unanswered' }])
  })
})
