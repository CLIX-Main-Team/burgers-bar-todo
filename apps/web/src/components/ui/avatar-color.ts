import { AVATAR_TONE_COUNT } from '@burgers/shared'

// Which of the eight person tones a disc wears (owner ask 2026-08-21, chosen colours 2026-09-04).
//
// Two sources, one rule. A person who has picked a colour on their Profile page carries it as
// `avatarTone` on every reference the API emits, and the disc wears that. Everyone else — and
// everyone until the day they choose — gets the colour hashed from their display name, which is
// how every disc was coloured before choosing existed. What matters more than the palette is that
// a person is the SAME disc on a task card, in the dashboard roster, in the person filter and in
// the People table, or the colour is decoration instead of a way to recognise somebody at a
// glance. Both sources hold that: a stored tone travels with the id, and a hashed one is a pure
// function of the name.
//
// The trade the hash accepts: two people can collide on a tone. With eight tones and a branch's
// worth of staff that is common, and it is fine — the initials, not the colour, are the identity;
// the colour only speeds the eye up. Renaming a person who has NOT chosen moves their colour, the
// honest consequence of deriving it from the name; choosing pins it.

const TONES = [
  'bg-person-1 text-person-1-ink',
  'bg-person-2 text-person-2-ink',
  'bg-person-3 text-person-3-ink',
  'bg-person-4 text-person-4-ink',
  'bg-person-5 text-person-5-ink',
  'bg-person-6 text-person-6-ink',
  'bg-person-7 text-person-7-ink',
  'bg-person-8 text-person-8-ink',
] as const

// The eight choices the Profile page offers, 1-based to match the column and the schema.
export const AVATAR_TONES: readonly number[] = Array.from(
  { length: AVATAR_TONE_COUNT },
  (_, index) => index + 1,
)

// The class pair for a stored tone. Out-of-range input cannot arrive from the API (the schema
// bounds it), so the fallback only guards the arithmetic.
export function toneClass(tone: number): string {
  return TONES[tone - 1] ?? TONES[0]
}

// The tone hashed from a name, as a 1-based number, so the Profile page can show which of the
// eight "automatic" resolves to for this person.
export function hashedTone(name: string): number {
  // A plain FNV-style walk over code points. It runs on every avatar render, so it stays
  // arithmetic on a short string — no allocation, no Intl, no normalisation. Code points rather
  // than UTF-16 units so a Hebrew name and a Latin one are hashed the same way, and `>>> 0`
  // keeps it unsigned after the multiply overflows into the sign bit.
  let hash = 2166136261
  for (const character of name.trim()) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return (hash % TONES.length) + 1
}

// The one resolver every disc goes through: the chosen tone when there is one, the name's hash
// when there is not.
export function avatarTone(name: string, tone?: number | null): string {
  return toneClass(tone ?? hashedTone(name))
}
