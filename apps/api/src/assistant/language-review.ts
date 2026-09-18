import { SOURCES_PREFIX } from './grounding.js'
import type { DraftForReview, DraftReview } from './tool-loop.js'

// An answer in the wrong language, caught outside the model (2026-09-18). The prompt says to
// answer in the language of the question; on production the club terms asked in Hebrew and then in
// English came back in Hebrew both times, because the model followed the previous turn. Like the
// source guard, this looks at each finished draft and sends it back once with the reason.
//
// The judgement is by script: the letters that carry the words, Hebrew or Latin. Digits, marks and
// the SOURCES trailer do not count, and a text needs a clear majority before it has a language at
// all, so an English answer that lists Hebrew task names, or a Hebrew one that quotes an English
// product name, is left alone.

export type AnswerLanguage = 'he' | 'en'

const HEBREW_LETTER = /[\u05d0-\u05ea]/g
const LATIN_LETTER = /[a-z]/gi
// Below this many letters a text is a greeting or a figure, and has no language worth enforcing.
const MIN_LETTERS = 12
// The share one script needs before the text counts as written in it.
const MAJORITY = 0.7

const NAMES: Record<AnswerLanguage, string> = { he: 'Hebrew', en: 'English' }

export function scriptOf(text: string, minLetters: number = MIN_LETTERS): AnswerLanguage | null {
  const hebrew = (text.match(HEBREW_LETTER) ?? []).length
  const latin = (text.match(LATIN_LETTER) ?? []).length
  const total = hebrew + latin
  if (total < minLetters) return null
  if (hebrew / total >= MAJORITY) return 'he'
  if (latin / total >= MAJORITY) return 'en'
  return null
}

const proseOf = (draft: string): string => {
  const at = draft.lastIndexOf(SOURCES_PREFIX)
  return at === -1 ? draft : draft.slice(0, at)
}

// The language the answer should have been written in, or null when it is, or when either side
// has no clear language. A question is short, so four letters are enough to read it.
// The language the chips and notes under an answer are written in (2026-09-18): the question's,
// since the answer follows it, and the account's preference when the question has no script.
export function questionLanguage(question: string, fallback: AnswerLanguage): AnswerLanguage {
  return scriptOf(question, 4) ?? fallback
}

export function languageMismatch(question: string, draft: string): AnswerLanguage | null {
  const expected = scriptOf(question, 4)
  const actual = scriptOf(proseOf(draft))
  if (expected === null || actual === null || expected === actual) return null
  return expected
}

export function languageInstruction(expected: AnswerLanguage, actual: AnswerLanguage): string {
  return [
    '[Automatic language check by the app. The person you are talking to did not write this and will not see it.]',
    `The question is written in ${NAMES[expected]} but your draft is in ${NAMES[actual]}. Write the whole answer again in ${NAMES[expected]}, keeping names, quotations and document titles as they are.`,
    `Do not mention this check. End with the ${SOURCES_PREFIX} line as before.`,
  ].join('\n')
}

export interface LanguageReview {
  review: DraftReview
  // Whether any draft of this answer was sent back for its language.
  objected(): boolean
}

export function createLanguageReview(): LanguageReview {
  let objected = false
  return {
    review: (draft: DraftForReview) => {
      const question = [...draft.messages].reverse().find((message) => message.role === 'user')
      if (question === undefined) return null
      const expected = languageMismatch(question.content, draft.content)
      if (expected === null) return null
      objected = true
      return languageInstruction(expected, expected === 'he' ? 'en' : 'he')
    },
    objected: () => objected,
  }
}
