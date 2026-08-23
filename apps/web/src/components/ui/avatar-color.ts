// Which of the eight person tones a name wears (owner ask 2026-08-21).
//
// The colour is picked by hashing the display name, not by a random draw and not by a list
// position. That matters more than the palette does: a person has to be the SAME disc on a task
// card, in the dashboard roster, in the person filter and in the People table, or the colour is
// decoration instead of a way to recognise somebody at a glance. Hashing the name is what makes
// it stable without storing a colour on the user row.
//
// The trade it accepts: two people can collide on a tone. With eight tones and a branch's worth
// of staff that is common, and it is fine — the initials, not the colour, are the identity; the
// colour only speeds the eye up. Renaming a person moves their colour, which is the honest
// consequence of deriving it from the name.

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

export function avatarTone(name: string): string {
  // A plain FNV-style walk over code points. It runs on every avatar render, so it stays
  // arithmetic on a short string — no allocation, no Intl, no normalisation. Code points rather
  // than UTF-16 units so a Hebrew name and a Latin one are hashed the same way, and `>>> 0`
  // keeps it unsigned after the multiply overflows into the sign bit.
  let hash = 2166136261
  for (const character of name.trim()) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return TONES[hash % TONES.length] ?? TONES[0]
}
