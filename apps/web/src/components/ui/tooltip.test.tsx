import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tooltip } from './tooltip.js'

// The hover line (2026-08-27). Two of these cases exist because the native `title` attribute
// failed them, which is why it was replaced: it never appears over a disabled control, and it
// never appears for somebody arriving by keyboard.

const LABEL = 'Scan the knowledge base for a checklist'

describe('Tooltip', () => {
  it('stays out of the way until the pointer arrives', () => {
    const { queryByText, getByRole } = render(
      <Tooltip label={LABEL}>
        <button type="button">scan</button>
      </Tooltip>,
    )
    expect(queryByText(LABEL)).toBeNull()

    fireEvent.pointerEnter(getByRole('button').parentElement as HTMLElement)
    expect(queryByText(LABEL)).not.toBeNull()
  })

  it('shows over a DISABLED control, which is where the native tooltip gave up', () => {
    const { queryByText, getByRole } = render(
      <Tooltip label={LABEL}>
        <button type="button" disabled>
          scan
        </button>
      </Tooltip>,
    )
    // The events land on the wrapper, not the button — a disabled button carries
    // `pointer-events: none` and is never hit-tested at all.
    fireEvent.pointerEnter(getByRole('button', { hidden: true }).parentElement as HTMLElement)
    expect(queryByText(LABEL)).not.toBeNull()
  })

  it('shows on keyboard focus and hides again on blur', () => {
    const { queryByText, getByRole } = render(
      <Tooltip label={LABEL}>
        <button type="button">scan</button>
      </Tooltip>,
    )
    const trigger = getByRole('button')

    fireEvent.focus(trigger)
    expect(queryByText(LABEL)).not.toBeNull()

    fireEvent.blur(trigger)
    expect(queryByText(LABEL)).toBeNull()
  })

  it('gets out of the way when the control is pressed by touch', () => {
    // A tap fires pointerEnter with no leave to follow it, so without this the bubble would sit
    // over the sheet on every touch press.
    const { queryByText, getByRole } = render(
      <Tooltip label={LABEL}>
        <button type="button">scan</button>
      </Tooltip>,
    )
    const wrapper = getByRole('button').parentElement as HTMLElement

    fireEvent.pointerEnter(wrapper)
    fireEvent.pointerDown(wrapper)
    expect(queryByText(LABEL)).toBeNull()
  })

  it('gets out of the way when the control is pressed by keyboard', () => {
    // Enter fires a click and no pointer event at all, and a control that disables itself on
    // activation drops focus to the body without React seeing a blur — so neither of the other
    // two exits fires. Left open, the bubble covered the status line reporting the very thing
    // the person had just started.
    const { queryByText, getByRole } = render(
      <Tooltip label={LABEL}>
        <button type="button">scan</button>
      </Tooltip>,
    )
    const trigger = getByRole('button')

    fireEvent.focus(trigger)
    expect(queryByText(LABEL)).not.toBeNull()

    fireEvent.click(trigger)
    expect(queryByText(LABEL)).toBeNull()
  })

  it('hides the bubble from assistive tech, because the control already carries the same words', () => {
    const { getByText, getByRole } = render(
      <Tooltip label={LABEL}>
        <button type="button" aria-label={LABEL}>
          scan
        </button>
      </Tooltip>,
    )
    fireEvent.pointerEnter(getByRole('button').parentElement as HTMLElement)
    // The words sit in an inner span so the stem can be positioned around them; what has to be
    // hidden is the bubble containing both, which is what a reader would otherwise walk into.
    expect(getByText(LABEL).closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
