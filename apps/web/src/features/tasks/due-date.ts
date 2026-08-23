// How a due date reads on the board (v2 handoff §4: "relative — Today, Tomorrow, 20 Aug").
//
// The near days get their names because that is how a shift talks about them, and because
// "Today" is the one word that changes what somebody does next. Everything past tomorrow
// falls back to the calendar day, which stays unambiguous a month out where "in 23 days"
// stops being useful.
//
// Both the comparison and the label work in the reader's own local day, never in UTC: a due
// date stored at midnight UTC is still "today" for someone in Israel, and the reverse.

export type DueDay = 'today' | 'tomorrow' | 'other'

// Whole days between two instants, counted between local midnights so a time-of-day
// difference can never push a date onto the wrong side of the boundary.
export function daysUntil(iso: string, now: Date): number {
  const due = new Date(iso)
  const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((dueMidnight.getTime() - nowMidnight.getTime()) / 86_400_000)
}

export function dueDay(iso: string, now: Date): DueDay {
  const days = daysUntil(iso, now)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return 'other'
}

// Overdue is a live comparison and never applies to a finished task. It is counted in whole
// days too, so a task due today is not overdue at four in the afternoon — it is due today,
// which is what the person reading it needs to know.
export function isOverdue(iso: string | null, status: string, now: Date): boolean {
  if (iso === null || status === 'done') return false
  return daysUntil(iso, now) < 0
}
