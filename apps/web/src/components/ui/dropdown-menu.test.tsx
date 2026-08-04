import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button.js'
import { DropdownMenu, DropdownMenuItem, DropdownMenuRadioItem } from './dropdown-menu.js'

function Menu({ onEdit }: { onEdit?: () => void }) {
  return (
    <DropdownMenu
      label="Task actions"
      trigger={(props) => (
        <Button {...props} aria-label="Open menu">
          menu
        </Button>
      )}
    >
      <DropdownMenuItem onSelect={onEdit ?? (() => {})}>Edit</DropdownMenuItem>
      <DropdownMenuRadioItem checked onSelect={() => {}}>
        Not started
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem checked={false} onSelect={() => {}}>
        Done
      </DropdownMenuRadioItem>
    </DropdownMenu>
  )
}

describe('DropdownMenu', () => {
  it('is closed until the trigger is clicked, and reflects state on aria-expanded', () => {
    const { getByRole, queryByRole } = render(<Menu />)
    const trigger = getByRole('button', { name: 'Open menu' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
  })

  it('selecting an item runs its handler and closes the menu', () => {
    const onEdit = vi.fn()
    const { getByRole, queryByRole } = render(<Menu onEdit={onEdit} />)
    fireEvent.click(getByRole('button', { name: 'Open menu' }))
    fireEvent.click(getByRole('menuitem', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(queryByRole('menu')).toBeNull()
  })

  it('marks the checked radio row with aria-checked', () => {
    const { getByRole } = render(<Menu />)
    fireEvent.click(getByRole('button', { name: 'Open menu' }))
    expect(getByRole('menuitemradio', { name: 'Not started' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(getByRole('menuitemradio', { name: 'Done' })).toHaveAttribute('aria-checked', 'false')
  })

  it('Escape closes the menu and returns focus to the trigger', () => {
    const { getByRole, queryByRole } = render(<Menu />)
    const trigger = getByRole('button', { name: 'Open menu' })
    fireEvent.click(trigger)
    fireEvent.keyDown(getByRole('menu'), { key: 'Escape' })
    expect(queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('a pointer press outside dismisses the menu', () => {
    const { getByRole, queryByRole } = render(<Menu />)
    fireEvent.click(getByRole('button', { name: 'Open menu' }))
    fireEvent.pointerDown(document.body)
    expect(queryByRole('menu')).toBeNull()
  })

  it('ArrowDown moves focus to the next row and wraps', () => {
    const { getByRole } = render(<Menu />)
    fireEvent.click(getByRole('button', { name: 'Open menu' }))
    const menu = getByRole('menu')
    // Opens with the first row focused; Arrow keys rove across the rows.
    expect(getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(getByRole('menuitemradio', { name: 'Not started' })).toHaveFocus()
  })
})
