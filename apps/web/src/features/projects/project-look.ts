import {
  ALWAYS_INVOLVED_PROJECT_ROLES,
  type ProjectBranch,
  type ProjectColour,
  type ProjectIcon,
  type ProjectPhase,
  type ProjectRole,
  type ProjectSummary,
  ROLES,
  isAlwaysInvolvedInProjects,
} from '@burgers/shared'
import { useTranslations } from 'use-intl'
import type { IconRole } from '../../components/ui/icon-registry.js'

// How a project is drawn. Four channels, and each one carries exactly one fact:
//
//   colour  — WHICH project it is (chosen by whoever made it)
//   glyph   — WHAT KIND of work it is (chosen with it)
//   rail    — HOW FAR along, one segment per task (derived, never chosen)
//   date    — WHEN it is expected
//
// The first two are picked by hand in the create dialog rather than derived from the name. That
// is the change from the fixture version: a project's name is not a category — two menu rollouts
// are different projects — and the person who owns the work is the one who knows which mark makes
// theirs findable on a page of twenty.

export const PROJECT_ICONS: ProjectIcon[] = [
  'menu',
  'opening',
  'audit',
  'equipment',
  'training',
  'marketing',
  'delivery',
  'hiring',
  'finance',
  'maintenance',
  'supplies',
  'event',
]

export const PROJECT_ICON_ROLE: Record<ProjectIcon, IconRole> = {
  menu: 'project-menu',
  opening: 'project-opening',
  audit: 'project-audit',
  equipment: 'project-equipment',
  training: 'project-training',
  marketing: 'project-marketing',
  delivery: 'project-delivery',
  hiring: 'project-hiring',
  finance: 'project-finance',
  maintenance: 'project-maintenance',
  supplies: 'project-supplies',
  event: 'project-event',
}

export const PROJECT_ICON_LABEL_KEY: Record<ProjectIcon, string> = {
  menu: 'projects.iconMenu',
  opening: 'projects.iconOpening',
  audit: 'projects.iconAudit',
  equipment: 'projects.iconEquipment',
  training: 'projects.iconTraining',
  marketing: 'projects.iconMarketing',
  delivery: 'projects.iconDelivery',
  hiring: 'projects.iconHiring',
  finance: 'projects.iconFinance',
  maintenance: 'projects.iconMaintenance',
  supplies: 'projects.iconSupplies',
  event: 'projects.iconEvent',
}

// The stages a project moves through. Deliberately NOT the task vocabulary — a task is
// not_started / in_progress / done, and reusing those words here would suggest the two mean the
// same thing. `completed` is last because the app sets it itself when the checklist finishes.
export const PROJECT_PHASES: ProjectPhase[] = [
  'planning',
  'preparation',
  'in_progress',
  'review',
  'completed',
]

export const PROJECT_PHASE_LABEL_KEY: Record<ProjectPhase, string> = {
  planning: 'projects.phasePlanning',
  preparation: 'projects.phasePreparation',
  in_progress: 'projects.phaseInProgress',
  review: 'projects.phaseReview',
  completed: 'projects.phaseCompleted',
}

// A phase is a stage, not a status, so it wears a quiet neutral chip everywhere except the one
// that means the work is over — that one earns the done ink the board already uses, because it is
// the only phase whose arrival is worth noticing across a grid.
export const PROJECT_PHASE_TONE: Record<ProjectPhase, string> = {
  planning: 'bg-muted text-muted-foreground',
  preparation: 'bg-muted text-muted-foreground',
  in_progress: 'bg-muted text-muted-foreground',
  review: 'bg-muted text-muted-foreground',
  completed: 'bg-status-done-dot/15 text-status-done-foreground',
}

// Everyone a project can involve, in the chain's own order of seniority so the picker reads the
// way an org chart does. All four, on the owner's call (2026-08-23) — the field says who is
// involved, and a list that quietly omitted the two admin roles would be describing a smaller
// company than the one using it.
//
// The two halves behave differently, and the locked rows below are what make that honest: naming a
// manager or an employee is what LETS them open the project, while the admin roles come with the
// branches instead. Chain-wide involves every admin, one branch involves that branch's admin, and
// the owner's chair is over all of it (2026-08-25) — so those two rows are ticked for you and
// cannot be unticked, rather than offering a choice the API would ignore (api projects/scope.ts).
export const PROJECT_ROLES: readonly ProjectRole[] = ROLES

// The half of that list the branch picker decides. Ticked on every project, never by hand.
//
// Re-exported from @burgers/shared rather than declared here: since 2026-08-28 the API derives the
// same set to work out who a checklist step may be handed to, and two copies of this list is two
// different answers to "who is on this project" the first time one of them is edited.
export const ALWAYS_INVOLVED_ROLES: readonly ProjectRole[] = ALWAYS_INVOLVED_PROJECT_ROLES

export const isAlwaysInvolved = isAlwaysInvolvedInProjects

export const PROJECT_COLOURS: ProjectColour[] = [
  'amber',
  'green',
  'violet',
  'teal',
  'orange',
  'pink',
]

// The six tones ride the app's one identity palette — the same `--person-N` pairs a person's
// avatar wears, because the app should have ONE set of identity colours rather than two that
// nearly match. Shape is what tells the two apart: a person is a circle of initials, a project a
// rounded square holding its glyph.
//
// Red and blue are deliberately not offered. Red already means destructive here and blue already
// means "you can click this"; letting a project claim either would put a second meaning on a
// colour that has one. Written as whole class strings because Tailwind only ships what it can see.
export const PROJECT_TILE: Record<ProjectColour, string> = {
  amber: 'bg-person-3 text-person-3-ink',
  green: 'bg-person-4 text-person-4-ink',
  violet: 'bg-person-7 text-person-7-ink',
  teal: 'bg-person-5 text-person-5-ink',
  orange: 'bg-person-2 text-person-2-ink',
  pink: 'bg-person-8 text-person-8-ink',
}

// The same grounds without their ink, for the progress rail — the one large field of a project's
// colour on the card, and what makes a grid of them scannable.
export const PROJECT_FILL: Record<ProjectColour, string> = {
  amber: 'bg-person-3',
  green: 'bg-person-4',
  violet: 'bg-person-7',
  teal: 'bg-person-5',
  orange: 'bg-person-2',
  pink: 'bg-person-8',
}

// The reading order of the grid: anything still open comes before anything finished, and within
// each half the nearest target day leads. A manager opens this screen to find what needs them,
// and a finished project never does. A project with no target date sorts last within its half —
// it is the one with the least to say about when it matters.
const STATUS_RANK: Record<ProjectSummary['status'], number> = {
  in_progress: 0,
  not_started: 1,
  done: 2,
}

export function sortForBoard(projects: ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.targetDate ?? '￿').localeCompare(b.targetDate ?? '￿') ||
      a.name.localeCompare(b.name),
  )
}

// How a project's branches are said in one line. Three cases, because a list that grows without
// limit stops being readable at about the third name and this chain is heading for forty-odd
// branches: none is the chain-wide answer and is STATED rather than left blank, one or two are
// named outright, and beyond that the count is the useful fact — the detail screen lists them all
// for anyone who needs the names.
export function useBranchLabel(): (branches: ProjectBranch[]) => string {
  const t = useTranslations()
  return (branches) => {
    if (branches.length === 0) return t('projects.chainWide')
    if (branches.length <= 2) return branches.map((branch) => branch.name).join(', ')
    return t('projects.branchCount', { count: branches.length })
  }
}

export function projectTotals(projects: ProjectSummary[]): { done: number; total: number } {
  return projects.reduce(
    (sum, project) => ({
      done: sum.done + project.doneCount,
      total: sum.total + project.taskCount,
    }),
    { done: 0, total: 0 },
  )
}

// A finished project reads 100% even if the counts were to disagree, and an empty one never
// divides by zero.
export function completionPercent(project: ProjectSummary): number {
  if (project.taskCount === 0) return 0
  return Math.round((Math.min(project.doneCount, project.taskCount) / project.taskCount) * 100)
}
