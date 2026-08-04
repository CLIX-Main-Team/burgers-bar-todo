import {
  ArrowLeft,
  CaretRight,
  ChatCircleDots,
  ListChecks,
  PaperPlaneTilt,
  SignOut,
} from '@phosphor-icons/react'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { ICON_REGISTRY, type IconRole } from './icon-registry.js'
import { Icon } from './icon.js'

// Every role the registry declares, and the four that ADR-0020 marks directional. Driving
// the sweeps off the registry keeps the tests honest: a new row is covered automatically,
// and the directional list is asserted against the data, not a hand-copy.
const ALL_ROLES = Object.keys(ICON_REGISTRY) as IconRole[]
const DIRECTIONAL: IconRole[] = ['back', 'row-forward', 'send', 'logout']

function renderIcon(el: ReactElement): SVGSVGElement {
  const { container } = render(el)
  const svg = container.querySelector('svg')
  if (!svg) {
    throw new Error('Icon rendered no <svg>')
  }
  return svg
}

// The path geometry Phosphor emits differs per weight, so comparing the rendered paths to a
// glyph drawn directly at a known weight pins the weight down exactly — not just "it changed".
function paths(svg: SVGSVGElement): string {
  return Array.from(svg.querySelectorAll('path'))
    .map((p) => p.getAttribute('d'))
    .join('|')
}

describe('Icon — role → glyph', () => {
  it('resolves each role to its ADR-0020 glyph through the registry', () => {
    expect(ICON_REGISTRY.tasks.glyph).toBe(ListChecks)
    expect(ICON_REGISTRY.assistant.glyph).toBe(ChatCircleDots)
    expect(ICON_REGISTRY.send.glyph).toBe(PaperPlaneTilt)
    expect(ICON_REGISTRY.back.glyph).toBe(ArrowLeft)
    expect(ICON_REGISTRY.logout.glyph).toBe(SignOut)
  })

  it('renders a Phosphor svg for the named role', () => {
    const svg = renderIcon(<Icon name="tasks" />)
    expect(svg).toHaveAttribute('viewBox', '0 0 256 256')
  })
})

describe('Icon — directionality', () => {
  it('tags exactly the four directional roles with icon--directional', () => {
    expect(DIRECTIONAL).toHaveLength(4)
    for (const role of ALL_ROLES) {
      const svg = renderIcon(<Icon name={role} label={role} />)
      if (DIRECTIONAL.includes(role)) {
        expect(svg, `${role} should be directional`).toHaveClass('icon--directional')
      } else {
        expect(svg, `${role} should be universal`).not.toHaveClass('icon--directional')
      }
    }
  })
})

describe('Icon — size', () => {
  it('defaults to md (size-5)', () => {
    expect(renderIcon(<Icon name="tasks" />)).toHaveClass('size-5')
  })

  it('maps sm/md/lg to size-4/size-5/size-6', () => {
    expect(renderIcon(<Icon name="tasks" size="sm" />)).toHaveClass('size-4')
    expect(renderIcon(<Icon name="tasks" size="md" />)).toHaveClass('size-5')
    expect(renderIcon(<Icon name="tasks" size="lg" />)).toHaveClass('size-6')
  })
})

describe('Icon — accessibility', () => {
  it('is decorative by default: aria-hidden, no role or label', () => {
    const svg = renderIcon(<Icon name="close" />)
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
    expect(svg).not.toHaveAttribute('aria-label')
  })

  it('with a label becomes role="img" + aria-label and drops aria-hidden', () => {
    const svg = renderIcon(<Icon name="send" label="Send message" />)
    expect(svg).toHaveAttribute('role', 'img')
    expect(svg).toHaveAttribute('aria-label', 'Send message')
    expect(svg).not.toHaveAttribute('aria-hidden')
  })
})

describe('Icon — weight', () => {
  it('rests at regular and flips to the reserved fill when active', () => {
    const rest = renderIcon(<Icon name="tasks" />)
    const active = renderIcon(<Icon name="tasks" active />)

    expect(paths(rest)).toBe(paths(renderIcon(<ListChecks weight="regular" />)))
    expect(paths(active)).toBe(paths(renderIcon(<ListChecks weight="fill" />)))
    // The two states must be visibly distinct — the whole point of the weight axis.
    expect(paths(active)).not.toBe(paths(rest))
  })
})

describe('Icon — registry integrity', () => {
  it('carries all 48 roles', () => {
    expect(ALL_ROLES).toHaveLength(48)
  })

  it('resolves every role to a renderable glyph coloured by currentColor (no color prop)', () => {
    for (const role of ALL_ROLES) {
      const svg = renderIcon(<Icon name={role} label={role} />)
      // currentColor, inherited from the surrounding token — the wrapper injects no colour.
      expect(svg, role).toHaveAttribute('fill', 'currentColor')
    }
  })
})
