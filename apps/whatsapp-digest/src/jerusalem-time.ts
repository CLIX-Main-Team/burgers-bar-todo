// The one place the Asia/Jerusalem wall clock is computed (ADR-0026). Two readers share it: the
// scheduler, which fires the daily digest at a local hour, and the transcript renderer, which
// stamps every message line with a local time. If each derived the local time its own way they
// could disagree about which day a message belongs to, so there is one module, one formatter, and
// one answer.
//
// No date library and no offset arithmetic: Intl.DateTimeFormat with a timeZone does the whole
// job, DST included. Israel changes its offset twice a year, so those two days are 23 and 25 hours
// long and a next fire computed as "now plus 24 hours" drifts on both. Asking for the local
// calendar date and hour instead is what keeps the daily fire on the hour the operator set.
export const DIGEST_TIMEZONE = 'Asia/Jerusalem'

const MS_PER_SECOND = 1000

// One formatter, built once: constructing an Intl.DateTimeFormat is the expensive part, and the
// transcript renderer asks for a time per message.
//
// Two of these options are load-bearing. hourCycle is 'h23' rather than hour12: false, because
// hour12 takes precedence over hourCycle when both are given and some ICU builds then render
// midnight as "24", which compares above every fire hour and would misfire the digest. And the
// locale is pinned rather than left to the host, because the machine's default locale chooses the
// numbering system, and a formatter that answers in Arabic-Indic digits turns Number() into NaN.
const jerusalemFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DIGEST_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

// formatToParts returns the parts in the locale's own order, so they are read by NAME. Indexing
// would be both fragile and, under noUncheckedIndexedAccess, possibly undefined. The fallbacks are
// unreachable for a part the formatter was asked for; they exist because find() is typed to miss.
const partValue = (
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
  fallback: string,
): string => parts.find((part) => part.type === type)?.value ?? fallback

// The Asia/Jerusalem wall clock at an instant. `date` is 'YYYY-MM-DD' LOCAL to Jerusalem (not UTC)
// and is the scheduler's fired-today key; hour is 0-23.
export interface JerusalemWallClock {
  date: string
  hour: number
  minute: number
}

export function jerusalemWallClock(instant: Date): JerusalemWallClock {
  const parts = jerusalemFormat.formatToParts(instant)
  const year = partValue(parts, 'year', '1970')
  const month = partValue(parts, 'month', '01')
  const day = partValue(parts, 'day', '01')
  return {
    date: `${year}-${month}-${day}`,
    hour: Number(partValue(parts, 'hour', '0')),
    minute: Number(partValue(parts, 'minute', '0')),
  }
}

// A journal timestamp as the local 'HH:MM' a transcript line carries. Green API stamps messages in
// UNIX SECONDS, not milliseconds, so the multiplication here is the difference between a 2026
// digest and a 1970 one.
export function formatJerusalemTime(unixSeconds: number): string {
  const { hour, minute } = jerusalemWallClock(new Date(unixSeconds * MS_PER_SECOND))
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
