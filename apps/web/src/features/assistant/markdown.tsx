import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.js'

// A deliberately small Markdown renderer for the assistant's answers (#93). Lifted from the CRM's
// chat body as a framework-agnostic helper and rebuilt to emit React nodes rather than an HTML
// string — so text is escaped by React automatically and there is no dangerouslySetInnerHTML surface
// for a model-authored answer to smuggle markup through (the assistant reply is untrusted output).
//
// It covers exactly the shape a step-by-step ops answer uses and nothing more: paragraphs, ordered
// and unordered lists, headings, and the inline run of **bold**, *italic* / _italic_, and `code`.
// Anything outside that subset renders as its own literal text, never as raw markup. Lists do not
// nest and tables/links/images are out of scope; the answer path's guardrail keeps replies to plain
// procedural prose, which this subset renders readably in both reading directions (logical spacing).

// --- inline formatting -------------------------------------------------------------------------

type InlineKind = 'code' | 'bold' | 'italic'

interface InlineToken {
  kind: InlineKind
  // The whole matched run, e.g. "**do this**", so the caller can advance past it.
  start: number
  length: number
  // The inner text, e.g. "do this". Recursed into for bold/italic; taken literally for code.
  inner: string
}

// Find the earliest inline token in `text`, if any. Order at a tie favours code, then bold, then
// italic, so `**x**` is bold (not two italics) and a backtick run wins over emphasis inside it.
function nextToken(text: string): InlineToken | null {
  const patterns: { kind: InlineKind; re: RegExp }[] = [
    { kind: 'code', re: /`([^`]+)`/ },
    { kind: 'bold', re: /\*\*([\s\S]+?)\*\*/ },
    // A single `*…*` or `_…_`; the `[^*]`/`[^_]` inner stops a bold `**` from matching here, so bold
    // is always preferred at the same index.
    { kind: 'italic', re: /\*([^*]+)\*|_([^_]+)_/ },
  ]
  let best: InlineToken | null = null
  for (const { kind, re } of patterns) {
    const m = re.exec(text)
    if (!m) continue
    const inner = m[1] ?? m[2] ?? ''
    if (best === null || m.index < best.start) {
      best = { kind, start: m.index, length: m[0].length, inner }
    }
  }
  return best
}

// Render an inline run to React nodes, recursing into bold/italic so emphasis can nest.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let rest = text
  let index = 0
  while (rest.length > 0) {
    const token = nextToken(rest)
    if (!token) {
      nodes.push(rest)
      break
    }
    if (token.start > 0) {
      nodes.push(rest.slice(0, token.start))
    }
    const key = `${keyPrefix}-${index++}`
    if (token.kind === 'code') {
      nodes.push(
        <code
          key={key}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {token.inner}
        </code>,
      )
    } else if (token.kind === 'bold') {
      nodes.push(
        <strong key={key} className="font-semibold">
          {renderInline(token.inner, key)}
        </strong>,
      )
    } else {
      nodes.push(<em key={key}>{renderInline(token.inner, key)}</em>)
    }
    rest = rest.slice(token.start + token.length)
  }
  return nodes
}

// --- block grouping ----------------------------------------------------------------------------

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'p'; text: string }

const HEADING = /^#{1,6}\s+(.*)$/
const UL_ITEM = /^\s*[-*+]\s+(.*)$/
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/

// Group raw lines into blocks. A blank line ends the current block; consecutive list items of the
// same kind fold into one list; consecutive plain lines fold into one paragraph (joined by spaces).
function toBlocks(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'p', text: paragraph.join(' ') })
      paragraph = []
    }
  }

  for (const line of lines) {
    if (line.trim() === '') {
      flushParagraph()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ kind: 'heading', text: heading[1] ?? '' })
      continue
    }
    const ul = UL_ITEM.exec(line)
    if (ul) {
      flushParagraph()
      appendListItem(blocks, 'ul', ul[1] ?? '')
      continue
    }
    const ol = OL_ITEM.exec(line)
    if (ol) {
      flushParagraph()
      appendListItem(blocks, 'ol', ol[1] ?? '')
      continue
    }
    paragraph.push(line.trim())
  }
  flushParagraph()
  return blocks
}

// Fold a list item onto the current block: extend the trailing list when it is the same kind, else
// start a new one. The one place ordered and unordered accumulation share, so the two differ only by
// the `kind` literal passed in.
function appendListItem(blocks: Block[], kind: 'ul' | 'ol', item: string): void {
  const last = blocks.at(-1)
  if (last?.kind === kind) last.items.push(item)
  else blocks.push({ kind, items: [item] })
}

// Render either list kind. `ul` and `ol` differ only in the element and the marker style; the item
// mapping (and its stable-position key) is shared, so there is one list renderer, not two twins.
function renderList(kind: 'ul' | 'ol', items: string[], key: string): ReactNode {
  const Tag = kind
  return (
    <Tag key={key} className={cn('space-y-1 ps-5', kind === 'ul' ? 'list-disc' : 'list-decimal')}>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: derived fresh each render from immutable text, never reordered, no per-item state — position is the stable identity.
        <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
      ))}
    </Tag>
  )
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case 'heading':
      return (
        <p key={key} className="font-semibold text-foreground">
          {renderInline(block.text, key)}
        </p>
      )
    case 'ul':
    case 'ol':
      return renderList(block.kind, block.items, key)
    default:
      return <p key={key}>{renderInline(block.text, key)}</p>
  }
}

// Render Markdown-lite text to React nodes. The caller styles the vertical rhythm (space-y) on the
// wrapper; each block carries only its own inner layout (list markers, heading weight).
export function Markdown({ text }: { text: string }) {
  return <>{toBlocks(text).map((block, i) => renderBlock(block, `b${i}`))}</>
}
