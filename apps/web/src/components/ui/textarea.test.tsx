import { render } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Textarea } from './textarea.js'

describe('Textarea', () => {
  it('forwards its ref to the underlying <textarea> so react-hook-form can register it', () => {
    const ref = createRef<HTMLTextAreaElement>()
    render(<Textarea ref={ref} defaultValue="hello" />)
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
    expect(ref.current?.value).toBe('hello')
  })

  it('merges a caller className over the token base rather than replacing it', () => {
    const { getByRole } = render(<Textarea className="max-h-40" />)
    const el = getByRole('textbox')
    // The token border stays; the caller cap is added alongside it.
    expect(el.className).toContain('border-input')
    expect(el.className).toContain('max-h-40')
  })

  it('spreads arbitrary textarea attributes through to the element', () => {
    const { getByLabelText } = render(<Textarea aria-label="Description" rows={5} dir="auto" />)
    const el = getByLabelText('Description') as HTMLTextAreaElement
    expect(el.rows).toBe(5)
    expect(el.getAttribute('dir')).toBe('auto')
  })
})
