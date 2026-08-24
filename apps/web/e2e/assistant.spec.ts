import { capabilitiesFor } from '@burgers/shared'
import { type Page, type Route, expect, test } from '@playwright/test'

// The Assistant conversation surface (#93), exercised against the built bundle with the session and
// the assistant API stubbed at the network edge (the same approach as tasks.spec.ts). The grounded
// answer path itself is proven in the API integration suite; here we prove the UI a staff member
// observes: a question renders then its answer, the answer's Markdown reveals readably, a failure
// offers an inline retry that keeps the question and adds no error turn, and the surface is direction
// -aware. Every assertion is on what the user sees, never on component state.

// A phone-sized viewport: this surface is mobile-first, and the smaller height lets the stick-to
// -bottom behaviour actually scroll.
test.use({ viewport: { width: 390, height: 720 } })

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  displayName: 'Noa Levi',
  role: 'employee',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
  capabilities: capabilitiesFor('employee'),
} as const

const THREAD_ID = '99999999-9999-9999-9999-999999999999'
const STAMP = '2026-01-01T00:00:00.000Z'

function userMessage(id: string, content: string) {
  return { id, role: 'user' as const, content, createdAt: STAMP }
}

function agentMessage(id: string, content: string) {
  return { id, role: 'agent' as const, content, createdAt: STAMP }
}

// The thread create returns the new thread with its one user turn (no answer yet, #90).
function createdThread(question: string) {
  return {
    id: THREAD_ID,
    title: question,
    createdAt: STAMP,
    updatedAt: STAMP,
    messages: [userMessage('m-create', question)],
  }
}

// The answer path returns the full updated history — the create turn, the posted question, and the
// agent reply (#91). The surface reads the trailing agent turn as the answer.
function answeredThread(question: string, answer: string) {
  return {
    id: THREAD_ID,
    title: question,
    createdAt: STAMP,
    updatedAt: STAMP,
    messages: [
      userMessage('m-create', question),
      userMessage('m-user', question),
      agentMessage('m-agent', answer),
    ],
  }
}

// Seed the bearer so the session provider issues its /auth/me read, fulfil that read with the
// employee principal, and wire the two assistant writes. `onMessage` lets a case script the answer
// route (e.g. fail once, then succeed) while create always succeeds.
async function stubAssistant(
  page: Page,
  onMessage: (route: Route, answer: string) => Promise<void> | void,
  answer: string,
) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: EMPLOYEE }))
  await page.route('**/threads', (route) => {
    const body = route.request().postDataJSON() as { content: string }
    return route.fulfill({ status: 201, json: createdThread(body.content) })
  })
  await page.route('**/threads/*/messages', (route) => onMessage(route, answer))
}

async function ask(page: Page, question: string) {
  const field = page.getByRole('textbox', { name: 'Your question' })
  await field.fill(question)
  await field.press('Enter')
}

test('a question renders, then its grounded answer reveals as readable Markdown', async ({
  page,
}) => {
  const answer = 'Here is the **opening** routine:\n\n1. Wash your hands\n2. Tie your apron'
  await stubAssistant(
    page,
    (route, ans) =>
      route.fulfill({ status: 201, json: answeredThread('the opening routine?', ans) }),
    answer,
  )
  await page.goto('/assistant')

  await ask(page, 'What is the opening routine?')

  // The question the user typed is echoed verbatim.
  await expect(page.getByText('What is the opening routine?')).toBeVisible()

  // The answer reveals in full (the typewriter completes) and renders as Markdown, not raw text:
  // the emphasis is a real <strong> and the steps are real list items. Scoped to the visible answer
  // bubble so the assertions are about what the reader sees, not the plain-text copy the sr-only
  // live region carries for assistive tech.
  const answerBubble = page.locator('[aria-label="Assistant answer"]')
  await expect(answerBubble.locator('strong', { hasText: 'opening' })).toBeVisible()
  await expect(
    answerBubble.getByRole('listitem').filter({ hasText: 'Wash your hands' }),
  ).toBeVisible()
  await expect(
    answerBubble.getByRole('listitem').filter({ hasText: 'Tie your apron' }),
  ).toBeVisible()
  // No raw Markdown markers survive into the rendered answer.
  await expect(answerBubble).not.toContainText('**')
})

test('the conversation sticks to the newest message as the answer arrives', async ({ page }) => {
  // A long answer overflows the phone viewport, so a surface that did not stick would leave the tail
  // below the fold.
  const steps = Array.from({ length: 14 }, (_, i) => `${i + 1}. Step number ${i + 1} to complete`)
  const answer = `The full closing routine:\n\n${steps.join('\n')}\n\nThat is the **final** step.`
  await stubAssistant(
    page,
    (route, ans) => route.fulfill({ status: 201, json: answeredThread('closing?', ans) }),
    answer,
  )
  await page.goto('/assistant')

  await ask(page, 'What is the closing routine?')

  // The last line of the answer is scrolled into view without the reader touching the scrollbar.
  await expect(page.locator('strong', { hasText: 'final' })).toBeInViewport()
})

test('a failed answer offers an inline retry that keeps the question and adds no error turn', async ({
  page,
}) => {
  let attempts = 0
  const answer = 'After a hiccup, here is your answer.'
  await stubAssistant(
    page,
    (route, ans) => {
      attempts += 1
      // The first attempt fails as a retryable model hiccup (503, nothing persisted); the retry wins.
      if (attempts === 1) {
        return route.fulfill({ status: 503, json: { error: 'assistant_unavailable' } })
      }
      return route.fulfill({ status: 201, json: answeredThread('anything?', ans) })
    },
    answer,
  )
  await page.goto('/assistant')

  await ask(page, 'How do I refund an order?')

  // The failure is inline: the notice and a retry appear, the question stays put, and no answer bubble
  // was ever added.
  await expect(page.getByText('That answer didn’t come through. Try again.')).toBeVisible()
  const retry = page.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible()
  await expect(page.getByText('How do I refund an order?')).toBeVisible()
  await expect(page.locator('[aria-label="Assistant answer"]')).toHaveCount(0)

  // Retrying re-asks the same question in place and the answer arrives; the error notice clears.
  await retry.click()
  await expect(page.locator('[aria-label="Assistant answer"]')).toContainText(answer)
  await expect(page.getByText('That answer didn’t come through. Try again.')).toHaveCount(0)
  // Exactly one copy of the question is shown — the retry did not echo a second user turn.
  await expect(page.getByText('How do I refund an order?')).toHaveCount(1)
})

test('the surface is direction-aware and its chrome is namespaced in both languages', async ({
  page,
}) => {
  await stubAssistant(
    page,
    (route, ans) => route.fulfill({ status: 201, json: answeredThread('q', ans) }),
    'ok',
  )
  await page.goto('/assistant')

  const html = page.locator('html')
  await expect(html).toHaveAttribute('dir', 'ltr')
  // The composer chrome resolves from the `assistant` namespace (English).
  await expect(page.getByPlaceholder('Write something…')).toBeVisible()

  // Flip to Hebrew from the account menu; the whole document flips to RTL and the chrome follows.
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('button', { name: 'עברית' }).click()
  await expect(html).toHaveAttribute('dir', 'rtl')
  await expect(html).toHaveAttribute('lang', 'he')
  await expect(page.getByPlaceholder('כתבו משהו…')).toBeVisible()
})
