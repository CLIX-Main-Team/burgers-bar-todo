import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { EXIT_MS } from './motion.js'
import { useExitTransition } from './use-exit-transition.js'

// A stand-in for the three modals: mounted only while `rendered`, flagged while `closing`.
function Panel({ open }: { open: boolean }) {
  const { rendered, closing } = useExitTransition(open, EXIT_MS)
  if (!rendered) return null
  return <div data-testid="panel" data-closing={closing ? 'yes' : 'no'} />
}

function Harness({ initial = true }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>
        close
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Panel open={open} />
    </>
  )
}

describe('useExitTransition', () => {
  it('renders nothing while closed', () => {
    render(<Harness initial={false} />)
    expect(screen.queryByTestId('panel')).toBeNull()
  })

  it('keeps the panel on screen, flagged, for the length of its exit', async () => {
    render(<Harness />)
    expect(screen.getByTestId('panel').dataset.closing).toBe('no')

    screen.getByRole('button', { name: 'close' }).click()

    // Still mounted — this is the whole point; a portalled modal unmounts instantly without it.
    await waitFor(() => expect(screen.getByTestId('panel').dataset.closing).toBe('yes'))
    await waitFor(() => expect(screen.queryByTestId('panel')).toBeNull())
  })

  it('cancels a pending unmount when it is reopened mid-exit', async () => {
    render(<Harness />)
    screen.getByRole('button', { name: 'close' }).click()
    await waitFor(() => expect(screen.getByTestId('panel').dataset.closing).toBe('yes'))

    screen.getByRole('button', { name: 'open' }).click()
    await waitFor(() => expect(screen.getByTestId('panel').dataset.closing).toBe('no'))

    // The pending timer from the first close must not fire against the reopened panel.
    await new Promise((resolve) => setTimeout(resolve, EXIT_MS * 2))
    expect(screen.getByTestId('panel')).toBeTruthy()
  })
})
