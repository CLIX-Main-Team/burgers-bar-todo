// Token estimation for every prompt budget in the answer path.
//
// This exists because the estimate used to be `length / 4` in two separate copies (retrieval.ts and
// grounding.ts), which is English math applied to a Hebrew-first corpus. Latin text really does run
// about four characters per token — the one real measurement available, a 29-character English
// prompt billed as 7 native tokens, gives 4.1 — but Hebrew is thinly covered by the byte-pair
// vocabularies these models ship, so an everyday word splits into two to four pieces and the ratio
// lands near half of Latin's. The consequence was that every budget lied about itself in the
// direction that costs money: a block named 4,000 tokens shipped roughly 7,000-8,000 on a Hebrew
// question, on every single answer, and the chunk sizes were about twice their intended band.
//
// HEBREW_CHARS_PER_TOKEN is an estimate, not a measurement. OpenRouter's generation-stats endpoint
// would settle it, but it reports for only some model and provider routes and refused for the ones
// tried, so this is deliberately one named constant: when per-answer token usage is logged, divide
// real prompt characters by real prompt tokens on Hebrew traffic and set this from data. Being
// somewhat wrong here is still far better than being 2x wrong in the expensive direction.
const LATIN_CHARS_PER_TOKEN = 4
const HEBREW_CHARS_PER_TOKEN = 2.2

// The Hebrew block, plus the Hebrew presentation forms block. Counted against total length rather
// than against letters only, so the spaces and punctuation that a Hebrew sentence carries are
// included in the denominator and a normal Hebrew paragraph lands around 0.75-0.8.
const HEBREW_CHARS = /[\u0590-\u05FF\uFB1D-\uFB4F]/gu

// A text's token cost, interpolated between the two ratios by how Hebrew the text actually is. A
// pure-Latin string is unchanged from the old behaviour, a Hebrew string costs about 1.8x what it
// used to be credited with, and a mixed string — a Hebrew procedure quoting English product names,
// or a table of Hebrew values under English headers — lands between them instead of being
// misjudged by whichever script the old single constant assumed.
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0
  }
  const hebrewRatio = (text.match(HEBREW_CHARS) ?? []).length / text.length
  const charsPerToken =
    LATIN_CHARS_PER_TOKEN - hebrewRatio * (LATIN_CHARS_PER_TOKEN - HEBREW_CHARS_PER_TOKEN)
  return Math.ceil(text.length / charsPerToken)
}
