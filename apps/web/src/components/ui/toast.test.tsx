import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { ToastProvider, useToast } from './toast.js'

function Trigger({ message, tone }: { message: string; tone?: 'error' | 'info' }) {
  const { show } = useToast()
  return (
    <button type="button" onClick={() => show(message, tone)}>
      report
    </button>
  )
}

function renderToasts(ui: React.ReactElement) {
  return render(
    <LocaleProvider>
      <ToastProvider>{ui}</ToastProvider>
    </LocaleProvider>,
  )
}

describe('ToastProvider', () => {
  it('mounts its live region before anything is in it, so the first report is announced', () => {
    const { container } = renderToasts(<Trigger message="anything" />)
    // The region lives in a portal on <body>, not inside the rendered container.
    expect(container.ownerDocument.body.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  it('shows what failed', async () => {
    renderToasts(<Trigger message="Couldn't move that task." />)
    fireEvent.click(screen.getByRole('button', { name: 'report' }))
    expect(await screen.findByText("Couldn't move that task.")).toBeTruthy()
  })

  it('reports a failure as an alert, so it is announced rather than merely seen', async () => {
    renderToasts(<Trigger message="Nope." />)
    fireEvent.click(screen.getByRole('button', { name: 'report' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('reports success as a status, which does not interrupt a screen reader mid-sentence', async () => {
    renderToasts(<Trigger message="Saved." tone="info" />)
    fireEvent.click(screen.getByRole('button', { name: 'report' }))
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('can be dismissed before it times out', async () => {
    renderToasts(<Trigger message="Go away." />)
    fireEvent.click(screen.getByRole('button', { name: 'report' }))
    await screen.findByText('Go away.')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('Go away.')).toBeNull())
  })

  it('refuses to be used without its provider, rather than silently reporting nothing', () => {
    // The failure this component exists to surface is exactly the one a no-op fallback would
    // hide, so the missing provider has to be loud.
    expect(() => render(<Trigger message="orphan" />)).toThrow(/ToastProvider/)
  })
})
