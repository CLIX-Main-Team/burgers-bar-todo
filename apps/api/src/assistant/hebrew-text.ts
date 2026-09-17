// Hebrew as people actually type it, folded so a typed word can match a stored one (#387).
//
// Moved out of tools.ts when the company website reader needed the same fold: the people search,
// the branch search and the website's title match all have to agree on what "the same word" means,
// and a fourth private copy is how they would drift apart.
//
// Every non-Latin character here is written as a codepoint escape, never as a literal. Niqqud and
// the bidi marks are invisible and combining, and a tool that round-trips source through a pipe
// can eat them without changing how the line looks.

const normalize = (text: string): string => text.toLowerCase().normalize('NFC')

// Niqqud and the bidi marks are invisible but change every comparison; the geresh and gershayim
// are typed as either the Hebrew punctuation or the ASCII quotes.
export const foldHebrew = (text: string): string =>
  normalize(text)
    .replace(/[\u0591-\u05c7]/g, '')
    .replace(/[\u200e\u200f]/g, '')
    .replace(/[\u05f3\u2019]/g, "'")
    .replace(/[\u05f4\u201c\u201d]/g, '"')

// The one-letter prefixes a Hebrew noun wears: the, and, in, to, from, as, that. "In Talpiot" is
// one word in Hebrew, and a raw substring match against the branch name "Talpiot" fails on that
// single letter, so both forms are indexed and both are searched for.
const HEBREW_PREFIXES = '\u05d4\u05d5\u05d1\u05dc\u05de\u05db\u05e9'

export const wordForms = (word: string): string[] =>
  word.length >= 4 && HEBREW_PREFIXES.includes(word[0] as string) ? [word, word.slice(1)] : [word]

export const searchableWords = (text: string): string[] =>
  foldHebrew(text)
    .split(/[^\p{L}\p{N}@.'"-]+/u)
    .filter((word) => word.length > 0)
    .flatMap(wordForms)
