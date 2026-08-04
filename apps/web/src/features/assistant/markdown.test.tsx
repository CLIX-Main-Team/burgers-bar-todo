import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown } from './markdown.js'

// The Markdown-lite renderer (#93): it must render the subset an ops answer uses — paragraphs,
// lists, headings, and inline emphasis/code — as real DOM, and it must treat anything model-authored
// as text, never as markup (the reply is untrusted output rendered through React nodes, not HTML).

function renderMarkdown(text: string): HTMLElement {
  const { container } = render(<Markdown text={text} />)
  return container
}

describe('Markdown — blocks', () => {
  it('renders blank-line-separated paragraphs as separate <p>', () => {
    const el = renderMarkdown('First line.\n\nSecond line.')
    const paragraphs = el.querySelectorAll('p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]?.textContent).toBe('First line.')
    expect(paragraphs[1]?.textContent).toBe('Second line.')
  })

  it('folds consecutive dash lines into one unordered list', () => {
    const el = renderMarkdown('- wash hands\n- tie apron\n- clock in')
    const lists = el.querySelectorAll('ul')
    expect(lists).toHaveLength(1)
    expect(el.querySelectorAll('ul > li')).toHaveLength(3)
    expect(el.querySelector('ol')).toBeNull()
  })

  it('renders a numbered list as an ordered list', () => {
    const el = renderMarkdown('1. open the till\n2. count the float')
    expect(el.querySelectorAll('ol')).toHaveLength(1)
    expect(el.querySelectorAll('ol > li')).toHaveLength(2)
  })

  it('renders a heading line as its own text block, not a list', () => {
    const el = renderMarkdown('## Opening routine\n\nDo the thing.')
    expect(el.textContent).toContain('Opening routine')
    expect(el.querySelector('ul')).toBeNull()
    // The leading hashes are consumed, not shown.
    expect(el.textContent).not.toContain('##')
  })
})

describe('Markdown — inline', () => {
  it('renders **bold** as <strong>', () => {
    const el = renderMarkdown('Please **stop** now.')
    expect(el.querySelector('strong')?.textContent).toBe('stop')
  })

  it('renders *italic* and _italic_ as <em>', () => {
    expect(renderMarkdown('a *star* b').querySelector('em')?.textContent).toBe('star')
    expect(renderMarkdown('a _under_ b').querySelector('em')?.textContent).toBe('under')
  })

  it('renders `code` as <code> and keeps its content literal', () => {
    const el = renderMarkdown('run `npm test` first')
    expect(el.querySelector('code')?.textContent).toBe('npm test')
  })

  it('nests emphasis: italic inside bold', () => {
    const el = renderMarkdown('**very *very* important**')
    const strong = el.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong?.querySelector('em')?.textContent).toBe('very')
  })

  it('renders inline emphasis inside list items', () => {
    const el = renderMarkdown('- do **this**\n- not that')
    expect(el.querySelector('li strong')?.textContent).toBe('this')
  })
})

describe('Markdown — safety', () => {
  it('renders raw HTML as visible text, never as markup', () => {
    const el = renderMarkdown('watch out <img src=x onerror="alert(1)"> ok')
    // No element was created from the model text; it is shown verbatim.
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">')
  })
})
