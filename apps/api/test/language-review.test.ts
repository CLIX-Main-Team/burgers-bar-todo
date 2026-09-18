import { describe, expect, it } from 'vitest'
import {
  createLanguageReview,
  languageMismatch,
  scriptOf,
} from '../src/assistant/language-review.js'
import type { LlmMessage } from '../src/assistant/llm-client.js'
import type { DraftForReview } from '../src/assistant/tool-loop.js'

// Found on production on 2026-09-17: the club terms asked in Hebrew, then asked again in English,
// came back in Hebrew both times. The prompt says to answer in the language of the question, and
// the model followed the previous turn instead. A check outside the model, like the source guard.

const TASKS_EN =
  'You currently have the following open tasks on your board:\n* **לבדוק רטבים** (Check sauces): not started, normal priority.\n* **לפתוח סניף** (Open a branch): not started, normal priority.'
const CLUB_HE =
  'תנאי מועדון הלקוחות של בורגרס בר כוללים את הנקודות הבאות: החברות תקפה ל-12 חודשים ממועד ההצטרפות, וניתן לבטל תוך 14 ימים.'
const CLUB_EN =
  'The customer club terms are these: membership is valid for 12 months from joining, and it can be cancelled within 14 days.'

describe('scriptOf: which language a text is written in', () => {
  it('reads Hebrew and English by the letters that carry the words', () => {
    expect(scriptOf(CLUB_HE)).toBe('he')
    expect(scriptOf(CLUB_EN)).toBe('en')
  })

  it('reads an English answer that lists Hebrew names as English', () => {
    expect(scriptOf(TASKS_EN)).toBe('en')
  })

  it('has no opinion on a text with too few letters, or an even mix', () => {
    expect(scriptOf('?')).toBeNull()
    expect(scriptOf('18%')).toBeNull()
    expect(scriptOf('שלום hello')).toBeNull()
  })
})

describe('languageMismatch: the language an answer should have been in', () => {
  it('asks for English when an English question got a Hebrew answer', () => {
    expect(languageMismatch('What are the customer club terms?', CLUB_HE)).toBe('en')
  })

  it('asks for Hebrew when a Hebrew question got an English answer', () => {
    expect(languageMismatch('מה התנאים של מועדון הלקוחות?', CLUB_EN)).toBe('he')
  })

  it('lets an English answer keep the Hebrew names in it', () => {
    expect(languageMismatch('Which open tasks do I have?', TASKS_EN)).toBeNull()
  })

  it('lets a Hebrew answer quote an English term', () => {
    expect(
      languageMismatch('יש המבורגר טבעוני?', 'כן, בתפריט יש המבורגר "Beyond", קציצה על בסיס צמחי.'),
    ).toBeNull()
  })

  it('ignores the SOURCES trailer, whose document titles may be in either language', () => {
    expect(
      languageMismatch(
        'Which open tasks do I have?',
        `${CLUB_EN}\n\nSOURCES: נוהל פתיחת סניף; תקנון מועדון`,
      ),
    ).toBeNull()
  })

  it('says nothing on a short answer or a question with no clear script', () => {
    expect(languageMismatch('What time is it?', 'שלום!')).toBeNull()
    expect(languageMismatch('18%', CLUB_HE)).toBeNull()
  })
})

describe('createLanguageReview: the hook the loop calls on each draft', () => {
  const question = (content: string): LlmMessage[] => [
    { role: 'system', content: 'You are the assistant.' },
    { role: 'user', content },
  ]
  const draft = (content: string, messages: LlmMessage[]): DraftForReview =>
    ({
      content,
      messages,
      trace: [],
      webSearched: false,
      citations: [],
      canSearch: false,
    }) as DraftForReview

  it('sends a draft back with the language named, and remembers that it did', () => {
    const check = createLanguageReview()
    const instruction = check.review(draft(CLUB_HE, question('What are the customer club terms?')))
    expect(instruction).toContain('English')
    expect(instruction).toContain('[Automatic language check')
    expect(check.objected()).toBe(true)
  })

  it('judges by the latest question, not an earlier turn in the other language', () => {
    const check = createLanguageReview()
    const messages: LlmMessage[] = [
      ...question('מה התנאים של מועדון הלקוחות?'),
      { role: 'assistant', content: CLUB_HE },
      { role: 'user', content: 'What are the customer club terms?' },
    ]
    expect(check.review(draft(CLUB_EN, messages))).toBeNull()
    expect(check.review(draft(CLUB_HE, messages))).toContain('English')
  })

  it('accepts a draft in the right language and says so', () => {
    const check = createLanguageReview()
    expect(check.review(draft(CLUB_EN, question('What are the customer club terms?')))).toBeNull()
    expect(check.objected()).toBe(false)
  })
})
