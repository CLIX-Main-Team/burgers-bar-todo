import { describe, expect, it } from 'vitest'
import { RTL_MARK, formatForWhatsapp } from '../src/whatsapp-format.js'

const HEADER = 'יום טוב! הנה הסיכום היומי מכל קבוצות הסניפים (04/09/2026):'
const BULLET = '•'

// The line starts WhatsApp claims as a native list. Once it does, it draws the bullet itself, on
// the left, and no character in our message can move it. Every one of these must be gone.
const CLAIMED_BY_WHATSAPP = ['- ', '* ', '1. ', '2. ', '1) ']

const lines = (text: string): string[] => text.split('\n')

describe('formatForWhatsapp', () => {
  it('puts the mark first on the greeting, so the opening line lays out right to left', () => {
    const out = formatForWhatsapp(HEADER, 'פתח תקווה\n- חסר אורז')

    expect(lines(out)[0]).toBe(RTL_MARK + HEADER)
  })

  it('keeps the asterisk at index 0 on a heading and hides the mark inside it', () => {
    // Bold only parses when the asterisk leads. Putting the mark in front of it is what broke the
    // headings on the first attempt, so on a heading the mark goes AFTER the marker, not before.
    const out = formatForWhatsapp(HEADER, 'פתח תקווה\n- חסר אורז')

    expect(lines(out)[2]).toBe(`*${RTL_MARK}פתח תקווה*`)
  })

  it('replaces a hyphen bullet with our own glyph behind the mark', () => {
    const out = formatForWhatsapp(HEADER, 'פתח תקווה\n- חסר אורז')

    expect(lines(out)[3]).toBe(`${RTL_MARK}${BULLET} חסר אורז`)
  })

  it('treats an asterisk bullet identically, because WhatsApp lists on both markers', () => {
    // The whole bug: the merge wrote "* " bullets and only "- " was believed to be a list marker.
    const hyphen = formatForWhatsapp(HEADER, 'פתח תקווה\n- חסר אורז')
    const asterisk = formatForWhatsapp(HEADER, 'פתח תקווה\n* חסר אורז')

    expect(asterisk).toBe(hyphen)
  })

  it('treats a numbered line as a bullet, since an ordered list is claimed the same way', () => {
    const out = formatForWhatsapp(HEADER, 'פתח תקווה\n1. חסר אורז\n2) חסר בשר')

    expect(lines(out)[3]).toBe(`${RTL_MARK}${BULLET} חסר אורז`)
    expect(lines(out)[4]).toBe(`${RTL_MARK}${BULLET} חסר בשר`)
  })

  it('leaves no line that WhatsApp would still claim as a list', () => {
    const body = ['פתח תקווה', '- אחד', '* שניים', '1. שלושה', '  - ארבעה'].join('\n')

    for (const line of lines(formatForWhatsapp(HEADER, body))) {
      expect(CLAIMED_BY_WHATSAPP.some((marker) => line.startsWith(marker))).toBe(false)
    }
  })

  it('strips the markdown bold a model emits around a branch name', () => {
    // WhatsApp bold is a single asterisk. "**name**" renders the extra asterisks as text.
    const out = formatForWhatsapp(HEADER, '**פתח תקווה**\n- חסר אורז')

    expect(lines(out)[2]).toBe(`*${RTL_MARK}פתח תקווה*`)
  })

  it('keeps bold intact when the branch name itself contains an asterisk', () => {
    // The busiest real group is named "מוקד הזמנות *2242". Left alone it closes the bold early.
    const out = formatForWhatsapp(HEADER, 'מוקד הזמנות *2242\n- חסר אורז')
    const heading = lines(out)[2] ?? ''

    expect(heading).toBe(`*${RTL_MARK}מוקד הזמנות 2242*`)
    expect(heading.split('*')).toHaveLength(3)
  })

  it('keeps the blank line between branches', () => {
    const body = ['פתח תקווה', '- אחד', '', 'פסגת זאב', '- שניים'].join('\n')

    expect(lines(formatForWhatsapp(HEADER, body))[4]).toBe('')
  })

  it('marks every line that carries text', () => {
    const body = ['פתח תקווה', '- אחד', '', 'פסגת זאב', '- שניים'].join('\n')

    for (const line of lines(formatForWhatsapp(HEADER, body))) {
      if (line.length > 0) {
        expect(line).toContain(RTL_MARK)
      }
    }
  })

  it('does not double the marks when the text has already been formatted', () => {
    // Cheap insurance against the pass being applied twice as the pipeline grows.
    const once = formatForWhatsapp(HEADER, 'פתח תקווה\n- חסר אורז')

    expect(formatForWhatsapp(HEADER, once.split('\n').slice(2).join('\n'))).toBe(once)
  })

  it('emits real invisible characters rather than escape text', () => {
    // An RLM that survives a terminal round trip is not an RLM. A backslash here means we shipped
    // the literal text \u200F, which is exactly what the client saw on the failed attempts.
    const out = formatForWhatsapp(HEADER, 'פתח תקווה\n- חסר אורז')

    expect(out).not.toContain('\\')
    expect(out.split(RTL_MARK)).toHaveLength(4)
  })

  it('drops a leading blank line, so the greeting keeps exactly one gap under it', () => {
    const out = formatForWhatsapp(HEADER, '\n\nפתח תקווה\n- חסר אורז')

    expect(out.split('\n')[1]).toBe('')
    expect(out.split('\n')[2]).toBe(`*${RTL_MARK}פתח תקווה*`)
  })

  it('drops trailing blank lines a model leaves behind', () => {
    const out = formatForWhatsapp(HEADER, 'פתח תקווה\n- חסר אורז\n\n\n')

    expect(out.endsWith(`${RTL_MARK}${BULLET} חסר אורז`)).toBe(true)
  })
})
