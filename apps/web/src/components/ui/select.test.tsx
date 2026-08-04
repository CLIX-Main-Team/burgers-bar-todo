import { fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Select, type SelectOption } from './select.js'

const OPTIONS: SelectOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]

// A tiny controlled host so a chosen value flows back and the trigger updates, the way a
// react-hook-form Controller drives it in the form.
function Host({ onValueChange }: { onValueChange?: (v: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <Select
      label="Priority"
      placeholder="Choose"
      value={value}
      onValueChange={(v) => {
        setValue(v)
        onValueChange?.(v)
      }}
      options={OPTIONS}
    />
  )
}

describe('Select (listbox)', () => {
  it('shows the placeholder until a value is chosen, and reflects state on aria-expanded', () => {
    const { getByRole, queryByRole } = render(<Host />)
    const trigger = getByRole('button')
    expect(trigger).toHaveTextContent('Choose')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(queryByRole('listbox')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(getByRole('listbox', { name: 'Priority' })).toBeInTheDocument()
  })

  it('choosing an option runs onValueChange, closes the list, and updates the trigger label', () => {
    const onValueChange = vi.fn()
    const { getByRole, queryByRole } = render(<Host onValueChange={onValueChange} />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByRole('option', { name: 'High' }))
    expect(onValueChange).toHaveBeenCalledWith('high')
    expect(queryByRole('listbox')).toBeNull()
    expect(getByRole('button')).toHaveTextContent('High')
  })

  it('marks the current option with aria-selected', () => {
    const { getByRole } = render(
      <Select label="Priority" value="normal" onValueChange={() => {}} options={OPTIONS} />,
    )
    fireEvent.click(getByRole('button'))
    expect(getByRole('option', { name: 'Normal' })).toHaveAttribute('aria-selected', 'true')
    expect(getByRole('option', { name: 'Low' })).toHaveAttribute('aria-selected', 'false')
  })

  it('opens onto the current option and roves with ArrowDown', () => {
    const { getByRole } = render(
      <Select label="Priority" value="low" onValueChange={() => {}} options={OPTIONS} />,
    )
    fireEvent.click(getByRole('button'))
    const list = getByRole('listbox')
    expect(getByRole('option', { name: 'Low' })).toHaveFocus()
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(getByRole('option', { name: 'Normal' })).toHaveFocus()
  })

  it('Enter on a focused option selects it', () => {
    const onValueChange = vi.fn()
    const { getByRole } = render(<Host onValueChange={onValueChange} />)
    fireEvent.click(getByRole('button'))
    const list = getByRole('listbox')
    // Opens on the first option (no selection yet); Arrow to High, Enter to choose.
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onValueChange).toHaveBeenCalledWith('high')
  })

  it('Escape closes the list and returns focus to the trigger', () => {
    const { getByRole, queryByRole } = render(<Host />)
    const trigger = getByRole('button')
    fireEvent.click(trigger)
    fireEvent.keyDown(getByRole('listbox'), { key: 'Escape' })
    expect(queryByRole('listbox')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('a pointer press outside dismisses the list', () => {
    const { getByRole, queryByRole } = render(<Host />)
    fireEvent.click(getByRole('button'))
    fireEvent.pointerDown(document.body)
    expect(queryByRole('listbox')).toBeNull()
  })

  it('carries the Field error wiring onto the trigger', () => {
    const { getByRole } = render(
      <Select
        label="Priority"
        value=""
        onValueChange={() => {}}
        options={OPTIONS}
        aria-invalid
        aria-describedby="p-msg"
      />,
    )
    const trigger = getByRole('button')
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAttribute('aria-describedby', 'p-msg')
  })
})
