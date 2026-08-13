import type { TaskStatus } from '@burgers/shared'
import { fireEvent, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { StatusControl } from './status-control.js'

// The pill resolves its own labels through i18n, so every render runs under the provider the app
// mounts it inside — the same pattern the feature-screen tests use.
function renderControl(props: {
  status: TaskStatus
  onSelect?: (status: TaskStatus) => void
  disabled?: boolean
}): ReturnType<typeof render> {
  const ui: ReactElement = (
    <IntlProvider locale="en" messages={messages.en}>
      <StatusControl
        status={props.status}
        onSelect={props.onSelect ?? (() => {})}
        disabled={props.disabled}
        label="Change status for Prep the buns"
      />
    </IntlProvider>
  )
  return render(ui)
}

describe('StatusControl', () => {
  it('renders an outlined chip in neutral ink with the status’ dot', () => {
    // The chip chrome is status-independent (design refresh 2026-08-12: the pastel fills are
    // gone) — outlined, radius-full, neutral ink — and the status marks itself with the small
    // dot from STATUS_DOT beside the label.
    const { getByText, container, unmount } = renderControl({ status: 'not_started' })
    expect(getByText('To-do')).toHaveClass(
      'border-border-strong',
      'bg-transparent',
      'text-foreground',
      'rounded-full',
    )
    expect(container.querySelector('.bg-status-not-started-dot')).not.toBeNull()
    unmount()

    const inProgress = renderControl({ status: 'in_progress' })
    expect(inProgress.container.querySelector('.bg-status-in-progress-dot')).not.toBeNull()
    inProgress.unmount()

    const done = renderControl({ status: 'done' })
    expect(done.container.querySelector('.bg-status-done-dot')).not.toBeNull()
  })

  it('exposes the trigger as a menu button that reflects open state', () => {
    const { getByRole, queryByRole } = renderControl({ status: 'not_started' })
    const trigger = getByRole('button', { name: 'To-do' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(getByRole('menu', { name: 'Change status for Prep the buns' })).toBeInTheDocument()
  })

  it('opens a menu of the three statuses with the current one checked', () => {
    const { getByRole, getAllByRole } = renderControl({ status: 'in_progress' })
    fireEvent.click(getByRole('button', { name: 'In progress' }))

    expect(getAllByRole('menuitemradio')).toHaveLength(3)
    // The current status reads as checked; the others do not.
    expect(getByRole('menuitemradio', { name: 'In progress' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(getByRole('menuitemradio', { name: 'To-do' })).toHaveAttribute('aria-checked', 'false')
    expect(getByRole('menuitemradio', { name: 'Done' })).toHaveAttribute('aria-checked', 'false')
  })

  it('calls onSelect with the chosen status and closes the menu', () => {
    const onSelect = vi.fn()
    const { getByRole, queryByRole } = renderControl({ status: 'not_started', onSelect })
    fireEvent.click(getByRole('button', { name: 'To-do' }))
    fireEvent.click(getByRole('menuitemradio', { name: 'Done' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith('done')
    expect(queryByRole('menu')).toBeNull()
  })

  it('does not offer the current status as a move (checked but inert)', () => {
    const onSelect = vi.fn()
    const { getByRole } = renderControl({ status: 'done', onSelect })
    fireEvent.click(getByRole('button', { name: 'Done' }))
    // The current row is disabled — moving to where it already is is a no-op.
    const current = getByRole('menuitemradio', { name: 'Done' })
    expect(current).toBeDisabled()
    fireEvent.click(current)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('holds every row inert while a write is in flight', () => {
    const onSelect = vi.fn()
    const { getByRole } = renderControl({ status: 'not_started', onSelect, disabled: true })
    fireEvent.click(getByRole('button', { name: 'To-do' }))
    const row = getByRole('menuitemradio', { name: 'In progress' })
    expect(row).toBeDisabled()
    fireEvent.click(row)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
