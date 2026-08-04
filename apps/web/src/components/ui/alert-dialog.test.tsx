import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlertDialog } from './alert-dialog.js'

function setup(overrides: Partial<Parameters<typeof AlertDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const result = render(
    <AlertDialog
      open
      title="Delete this task?"
      confirmLabel="Delete"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { ...result, onConfirm, onCancel }
}

describe('AlertDialog', () => {
  it('renders nothing while closed', () => {
    const { queryByRole } = render(
      <AlertDialog
        open={false}
        title="Delete this task?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(queryByRole('alertdialog')).toBeNull()
  })

  it('opens with focus on Cancel, the safe default', () => {
    const { getByRole } = setup()
    expect(getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('confirms through the destructive action', () => {
    const { getByRole, onConfirm } = setup()
    fireEvent.click(getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('Escape cancels', () => {
    const { getByRole, onCancel } = setup()
    fireEvent.keyDown(getByRole('alertdialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('disables confirm while the action is pending', () => {
    const { getByRole } = setup({ confirmDisabled: true })
    expect(getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})
