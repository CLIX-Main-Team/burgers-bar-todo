import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../components/ui/dialog.js'
import { Sheet } from '../components/ui/sheet.js'
import { messages } from '../i18n/messages.js'

// The plugin pair, stood in for so a test can play the part of the phone: `isNativePlatform`
// decides whether the handler attaches at all, and `addListener` hands back the callback Android
// would invoke on a back press.
const listeners: ((event: { canGoBack: boolean }) => void)[] = []
const exitApp = vi.fn()
let native = true

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native },
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_event: string, handler: (event: { canGoBack: boolean }) => void) => {
      listeners.push(handler)
      return Promise.resolve({ remove: () => {} })
    },
    exitApp: () => exitApp(),
  },
}))

const { registerBackButton } = await import('./back-button.js')

function renderWithIntl(ui: ReactNode) {
  return render(
    <IntlProvider locale="en" messages={messages.en}>
      {ui}
    </IntlProvider>,
  )
}

// One press of the phone's back gesture.
async function pressBack(canGoBack: boolean) {
  await registerBackButton()
  const handler = listeners[listeners.length - 1]
  if (!handler) throw new Error('no back handler was attached')
  handler({ canGoBack })
}

beforeEach(() => {
  native = true
  listeners.length = 0
  exitApp.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerBackButton', () => {
  it('attaches nothing in a browser', async () => {
    native = false
    await registerBackButton()
    expect(listeners).toHaveLength(0)
  })

  it('goes back a screen when there is one behind', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    await pressBack(true)
    expect(back).toHaveBeenCalledOnce()
    expect(exitApp).not.toHaveBeenCalled()
  })

  it('leaves the app from the first screen', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    await pressBack(false)
    expect(exitApp).toHaveBeenCalledOnce()
    expect(back).not.toHaveBeenCalled()
  })

  // The two that matter: an open overlay has to eat the press. Both cases render the real
  // component rather than a stand-in, because what is being tested is exactly the assumption that
  // a replayed Escape reaches it — a Dialog listening at the document, and a Sheet listening on
  // its own panel from inside a portal.
  it('closes an open dialog instead of navigating', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const onClose = vi.fn()
    renderWithIntl(
      <Dialog open onClose={onClose} title="New task">
        <input aria-label="Title" />
      </Dialog>,
    )
    await pressBack(true)
    expect(onClose).toHaveBeenCalledOnce()
    expect(back).not.toHaveBeenCalled()
    expect(exitApp).not.toHaveBeenCalled()
  })

  it('closes an open sheet instead of leaving the app', async () => {
    const onClose = vi.fn()
    renderWithIntl(
      <Sheet open onClose={onClose} title="New task">
        <button type="button">Save</button>
      </Sheet>,
    )
    await pressBack(false)
    expect(onClose).toHaveBeenCalledOnce()
    expect(exitApp).not.toHaveBeenCalled()
  })
})
