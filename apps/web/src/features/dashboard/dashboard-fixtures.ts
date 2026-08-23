// The only invented numbers on the Home screen: the six days behind today.
//
// Everything else Home draws is the live board read. History is the one thing the API cannot
// answer — a task carries its current status, not the status it held on Tuesday — so until a
// completions table exists these six columns stand in for it. Today's column is always the
// real count, which is why the card says "the six days before today are sample data" rather
// than labelling the whole chart a mock.
//
// Delete this file the day the API can answer "how many were finished on a given day".
export interface DemoDay {
  /** How many days before today this column is: 6 is a week ago, 1 is yesterday. */
  daysAgo: number
  done: number
  total: number
}

// A believable week for one branch: a strong run mid-week, a Friday that ran long, and a
// Saturday nearly clear — a burger kitchen's week is not a flat line, and a flat one would
// make the chart look broken rather than calm.
export const DEMO_WEEK: readonly DemoDay[] = [
  { daysAgo: 6, done: 9, total: 12 },
  { daysAgo: 5, done: 12, total: 12 },
  { daysAgo: 4, done: 8, total: 13 },
  { daysAgo: 3, done: 11, total: 12 },
  { daysAgo: 2, done: 6, total: 14 },
  { daysAgo: 1, done: 10, total: 11 },
]
