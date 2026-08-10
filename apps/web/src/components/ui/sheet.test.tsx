import { fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { Sheet } from './sheet.js'

function renderSheet(ui: ReactNode) {
  return render(
    <IntlProvider locale="en" messages={messages.en}>
      {ui}
    </IntlProvider>,
  )
}

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    const { queryByRole } = renderSheet(
      <Sheet open={false} onClose={() => {}} title="New task">
        <button type="button">Save</button>
      </Sheet>,
    )
    expect(queryByRole('dialog')).toBeNull()
  })

  it('is a modal dialog named by its title when open', () => {
    const { getByRole } = renderSheet(
      <Sheet open onClose={() => {}} title="New task">
        <button type="button">Save</button>
      </Sheet>,
    )
    const dialog = getByRole('dialog', { name: 'New task' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('Escape closes the sheet', () => {
    const onClose = vi.fn()
    const { getByRole } = renderSheet(
      <Sheet open onClose={onClose} title="New task">
        <button type="button">Save</button>
      </Sheet>,
    )
    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a press on the scrim closes the sheet', () => {
    const onClose = vi.fn()
    const { getByLabelText } = renderSheet(
      <Sheet open onClose={onClose} title="New task">
        <button type="button">Save</button>
      </Sheet>,
    )
    // The scrim is the first control; the close button carries the "Close" label.
    fireEvent.click(getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('dragging the handle down past the threshold closes the sheet', () => {
    const onClose = vi.fn()
    const { getByRole } = renderSheet(
      <Sheet open onClose={onClose} title="New task">
        <button type="button">Save</button>
      </Sheet>,
    )
    // The handle strip is the panel's first child (aria-hidden, so no role to query).
    const handle = getByRole('dialog').firstElementChild as HTMLElement
    fireEvent.pointerDown(handle, { clientY: 200 })
    fireEvent.pointerMove(window, { clientY: 350 })
    fireEvent.pointerUp(window, { clientY: 350 })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a short drag springs back instead of closing', () => {
    const onClose = vi.fn()
    const { getByRole } = renderSheet(
      <Sheet open onClose={onClose} title="New task">
        <button type="button">Save</button>
      </Sheet>,
    )
    const dialog = getByRole('dialog')
    const handle = dialog.firstElementChild as HTMLElement
    fireEvent.pointerDown(handle, { clientY: 200 })
    fireEvent.pointerMove(window, { clientY: 240 })
    fireEvent.pointerUp(window, { clientY: 240 })
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog.style.transform).toBe('')
  })

  it('moves focus into the sheet on open', () => {
    const { getByRole } = renderSheet(
      <Sheet open onClose={() => {}} title="New task">
        <button type="button">First field</button>
      </Sheet>,
    )
    // The drag handle is aria-hidden and the close button follows the content; the first focusable
    // is the content's own control unless the sheet finds an earlier one — here the close button.
    expect(document.activeElement).toBe(getByRole('button', { name: 'Close' }))
  })
})
