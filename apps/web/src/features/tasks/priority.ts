import type { TaskPriority } from '@burgers/shared'

// How a priority is painted, in one place, because it is shown in four (the card badge, the
// list column, the dialog's picker, and that picker's own menu) and three of them had drifted
// into different colours for the same word — the card said amber, the list said red.
//
// The tokens themselves live in index.css beside the status tones. Normal is the floor every
// task starts at and carries no information, so it stays neutral ink and is usually not drawn
// at all; only a raised priority earns a mark.

export const PRIORITY_INK: Record<TaskPriority, string> = {
  normal: 'text-priority-normal',
  medium: 'text-priority-medium',
  high: 'text-priority-high',
}

export const PRIORITY_SOFT: Record<TaskPriority, string> = {
  normal: 'bg-priority-normal-soft',
  medium: 'bg-priority-medium-soft',
  high: 'bg-priority-high-soft',
}

// The pill a chosen priority wears: its own ink on its own ground, at low alpha so it sits on
// whatever surface it lands on (owner call 2026-08-21).
export function priorityPill(priority: TaskPriority): string {
  return `${PRIORITY_INK[priority]} ${PRIORITY_SOFT[priority]}`
}

// Whether a priority is worth drawing at all. Normal is the default and says nothing, so a
// board that marked every card with it would be a board of noise.
export function isRaised(priority: TaskPriority): boolean {
  return priority !== 'normal'
}
