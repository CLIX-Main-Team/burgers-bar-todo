// Splitting an ingested doc into retrieval chunks (ADR-0025). Grounding matches a question
// against these pieces rather than whole documents, so one long spreadsheet can no longer crowd
// a short checklist out of the budget — every candidate is roughly the same size, and only the
// relevant pieces of a doc are injected.
//
// The split is structural, not semantic: paragraphs (blank-line boundaries) are packed whole
// while they fit, an oversized paragraph falls back to line packing (the shape of the xlsx/html
// extractors' row-per-line output), and only a single monster line is ever hard-cut. Pure and
// deterministic — the same content always yields the same chunks, which is what lets the sync
// skip re-embedding untouched docs.

// ~450 tokens at the corpus's ~4 chars/token — the fact-lookup end of the 2026 chunking
// guidance (400–512), sized so a handful of chunks fit the grounding budget together.
export const CHUNK_TARGET_CHARS = 1_800

// A tail smaller than this merges into the previous chunk rather than standing alone: a
// two-line remainder is noise as a retrieval unit but harmless appended to its neighbour.
const MIN_TAIL_CHARS = 400

// Greedily pack parts into chunks of at most `limit` chars, joining with `glue`. A single part
// longer than the limit is recursed into `splitOversized`.
const pack = (
  parts: string[],
  glue: string,
  limit: number,
  splitOversized: (part: string) => string[],
): string[] => {
  const chunks: string[] = []
  let current = ''
  const flush = () => {
    if (current.length > 0) {
      chunks.push(current)
      current = ''
    }
  }
  for (const part of parts) {
    if (part.length > limit) {
      flush()
      chunks.push(...splitOversized(part))
      continue
    }
    const joined = current.length > 0 ? `${current}${glue}${part}` : part
    if (joined.length > limit) {
      flush()
      current = part
    } else {
      current = joined
    }
  }
  flush()
  return chunks
}

// Hard-cut a single line that alone exceeds the limit (a pathological unbroken run — the
// extractors emit line-shaped text, so this is the guard, not the path).
const hardSplit = (text: string, limit: number): string[] => {
  const pieces: string[] = []
  for (let start = 0; start < text.length; start += limit) {
    pieces.push(text.slice(start, start + limit))
  }
  return pieces
}

// Split one doc's extracted text into ordered chunks. Empty/whitespace content yields no
// chunks (a near-empty doc grounds nothing, matching how the repository read treats it).
export function chunkDocContent(
  content: string,
  targetChars: number = CHUNK_TARGET_CHARS,
): string[] {
  const trimmed = content.trim()
  if (trimmed.length === 0) {
    return []
  }

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)

  const splitParagraph = (paragraph: string): string[] =>
    pack(
      paragraph.split('\n').map((line) => line.trim()),
      '\n',
      targetChars,
      (line) => hardSplit(line, targetChars),
    )

  const chunks = pack(paragraphs, '\n\n', targetChars, splitParagraph)

  // Fold an undersized tail into its predecessor so no stray two-line chunk dilutes retrieval.
  const tail = chunks[chunks.length - 1]
  const prev = chunks[chunks.length - 2]
  if (tail !== undefined && prev !== undefined && tail.length < MIN_TAIL_CHARS) {
    chunks.splice(chunks.length - 2, 2, `${prev}\n\n${tail}`)
  }
  return chunks
}
