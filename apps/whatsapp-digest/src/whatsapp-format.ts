// Turn the merged briefing into text WhatsApp renders right to left, with the bullets on the side
// Hebrew readers expect.
//
// Two problems hide behind one symptom here, and fixing only the obvious one is why several earlier
// attempts changed nothing.
//
// DIRECTION. Unicode decides it one paragraph at a time (UAX #9, rule P1), and a newline starts a
// new paragraph. Each paragraph takes its direction from its own first strong character and ignores
// every line above it, so a mark at the top of a message does nothing for line five. It has to be
// repeated on every line.
//
// LISTS, which is what actually produced the bug. WhatsApp claims any line starting "- ", "* " or
// "1. " as a native list, and then draws the bullet glyph itself, client side, on the left. That
// glyph is not a character in the message, so nothing we send can move it. Both unordered markers
// do this, not only the hyphen, and the merge writes "* " bullets.
//
// U+200F RIGHT-TO-LEFT MARK answers both at once. It is invisible and zero width, and its bidi
// class is R, meaning strong right-to-left. Placing it first forces the paragraph RTL *and* pushes
// the list marker off index 0 so WhatsApp never claims the line, which leaves the bullet as
// ordinary text we position ourselves.
export const RTL_MARK = '\u200F'

// Ours, not WhatsApp's. Chosen because it is not a list marker, so it stays plain text.
const BULLET = '•'

// A line WhatsApp would take over. Ordered lists are claimed the same way as unordered ones, and a
// model reaches for all of these, so every form is rewritten rather than trusted.
const LIST_LINE = /^(?:[-*•]|\d+[.)])\s+/

// WhatsApp's own bold, italic and strike delimiters. A branch name carrying one closes the emphasis
// early: the busiest real group is named "מוקד הזמנות *2242", which would end the bold at the star
// and leave the digits outside it.
const DELIMITERS = /[*_~]/g

// Strip marks we may have added before, so running this twice cannot stack them. Everything below
// rebuilds from clean text rather than editing text in place, which is what makes the pass safe to
// apply more than once as the pipeline grows.
const clean = (line: string): string => line.split(RTL_MARK).join('').trim()

const asBullet = (text: string): string => `${RTL_MARK}${BULLET} ${text}`

// The mark goes AFTER the asterisk, not before it. Bold only parses when the asterisk is at index
// 0, so shielding a heading the way a bullet is shielded is exactly what breaks it.
const asHeading = (text: string): string => `*${RTL_MARK}${text.replace(DELIMITERS, '').trim()}*`

export function formatForWhatsapp(header: string, body: string): string {
  // Trimmed at both ends, so a model that opens or closes with a stray newline cannot put a second
  // blank line under the greeting or a ragged tail under the last finding.
  const formatted = body
    .trim()
    .split('\n')
    .map((line) => {
      const text = clean(line)
      if (text.length === 0) {
        return ''
      }
      return LIST_LINE.test(text) ? asBullet(text.replace(LIST_LINE, '')) : asHeading(text)
    })

  return [RTL_MARK + clean(header), '', ...formatted].join('\n').replace(/\n+$/, '')
}
