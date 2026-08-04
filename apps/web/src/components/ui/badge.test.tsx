import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge.js'

describe('Badge', () => {
  it('renders its children in a pill', () => {
    const { getByText } = render(<Badge>High</Badge>)
    const chip = getByText('High')
    expect(chip).toHaveClass('rounded-full')
  })

  it('paints each family with its soft status tokens', () => {
    const { getByText } = render(
      <>
        <Badge variant="muted">Low</Badge>
        <Badge variant="warning">High</Badge>
        <Badge variant="success">Done</Badge>
        <Badge variant="accent">In progress</Badge>
      </>,
    )
    // Soft (tinted) variants only, so small chip text clears 4.5:1 (components.md §Badge).
    expect(getByText('Low')).toHaveClass('bg-muted', 'text-muted-foreground')
    expect(getByText('High')).toHaveClass('bg-warning-muted', 'text-warning-muted-foreground')
    expect(getByText('Done')).toHaveClass('bg-success-muted', 'text-success-muted-foreground')
    expect(getByText('In progress')).toHaveClass('bg-accent', 'text-accent-foreground')
  })
})
