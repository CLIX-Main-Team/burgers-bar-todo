import {
  ArrowClockwise,
  ArrowLeft,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  ChatsCircle,
  Check,
  CheckCircle,
  Circle,
  CircleHalf,
  Clock,
  DotsSixVertical,
  DotsThree,
  Eye,
  EyeSlash,
  FileText,
  Folder,
  Gear,
  type Icon as Glyph,
  type IconWeight,
  Info,
  ListChecks,
  MagnifyingGlass,
  MapPin,
  Moon,
  NotePencil,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Prohibit,
  SignOut,
  SortAscending,
  Storefront,
  Sun,
  Translate,
  Trash,
  Tray,
  UserCircle,
  UserMinus,
  Users,
  Warning,
  WarningCircle,
  X,
} from '@phosphor-icons/react'

// The single source of truth behind <Icon> (ADR-0020, docs/design-system/iconography.md):
// role -> { glyph, directional?, defaultWeight? }. Call sites address a semantic role and
// never import a Phosphor glyph name, so swapping the library or a role's glyph is a
// registry edit, never a call-site sweep. Directionality lives here as data — the wrapper
// enforces the RTL mirror off the flag, so no call site can forget it.
//
// `directional: true` is set on exactly the roles whose glyph carries a reading direction
// (back, row-forward/next, send, log out, the pager arrows); everything else is universal and
// stays put in RTL. `defaultWeight` is the resting weight and is `regular` for every role
// today — `fill` is reserved as the active/selected signal and is applied by the wrapper's
// `active` prop, not stored here (Weight, iconography.md).
export interface RegistryEntry {
  glyph: Glyph
  directional?: boolean
  defaultWeight?: IconWeight
}

export const ICON_REGISTRY = {
  // — Navigation & chrome —
  tasks: { glyph: ListChecks }, // regular -> fill when the destination is active
  assistant: { glyph: ChatCircleDots }, // regular -> fill when active
  create: { glyph: Plus },
  search: { glyph: MagnifyingGlass }, // the board content-header's filter field (desktop)
  account: { glyph: UserCircle },
  back: { glyph: ArrowLeft, directional: true },

  // — Account menu —
  profile: { glyph: UserCircle },
  'theme-light': { glyph: Sun },
  'theme-dark': { glyph: Moon },
  language: { glyph: Translate },
  settings: { glyph: Gear },
  'manage-users': { glyph: Users },
  'manage-locations': { glyph: Storefront }, // branches/Locations admin surface (#165)
  // A single branch named in content — the card's branch chip and the People/Locations
  // filters (The Counter, round 8). Distinct from `manage-locations`, which marks the
  // admin surface itself.
  location: { glyph: MapPin },
  logout: { glyph: SignOut, directional: true },

  // — Menus, sheets & disclosure —
  close: { glyph: X },
  selected: { glyph: Check },
  disclosure: { glyph: CaretDown },
  'row-forward': { glyph: CaretRight, directional: true },

  // — Task board —
  'status-not-started': { glyph: Circle }, // regular -> fill when current
  'status-in-progress': { glyph: CircleHalf }, // regular -> fill when current
  'status-done': { glyph: CheckCircle }, // regular -> fill when current
  'priority-high': { glyph: Warning }, // painted warning-soft by its badge, not a colour prop
  'sort-priority': { glyph: SortAscending }, // the board's priority-lens toggle
  'due-date': { glyph: CalendarBlank },
  overdue: { glyph: Clock },
  backlog: { glyph: Tray },
  edit: { glyph: PencilSimple },
  delete: { glyph: Trash },
  drag: { glyph: DotsSixVertical },
  overflow: { glyph: DotsThree }, // the card's quiet actions menu (Edit / Move to / Delete)
  // The lane pager's step arrows (owner call 2026-08, the CRM's per-column pager): reading
  // arrows, so they mirror in RTL — "previous" points at the reading start in both scripts.
  'pager-prev': { glyph: CaretLeft, directional: true },
  'pager-next': { glyph: CaretRight, directional: true },

  // — Assistant —
  send: { glyph: PaperPlaneTilt, directional: true },
  threads: { glyph: ChatsCircle },
  'new-thread': { glyph: NotePencil },
  'knowledge-doc': { glyph: FileText },
  // The Knowledge tab's category shelves (ADR-0024) — a plain closed folder, shape-symmetric,
  // so it never mirrors under RTL.
  folder: { glyph: Folder },
  'grounded-refusal': { glyph: Info },

  // — Auth & people —
  'show-password': { glyph: Eye },
  'hide-password': { glyph: EyeSlash },
  'resend-invite': { glyph: ArrowClockwise },
  'revoke-invite': { glyph: Prohibit },
  'deactivate-user': { glyph: UserMinus },
  // Reactivate shares resend's arrow-clockwise glyph (mockup #179) but is its own semantic
  // role — a call site names the action it takes, never borrows another role for its glyph.
  'reactivate-user': { glyph: ArrowClockwise },
  // The roster's status-section headers (people build, mockup #179): one glyph per user
  // status, named for the section it marks — kept distinct from `send` / `deactivate-user`,
  // which happen to share a glyph but are directional (send) or an action, not a section
  // marker. Universal, so they never mirror in RTL (a section head is not a reading arrow).
  'people-invited': { glyph: PaperPlaneTilt },
  'people-active': { glyph: CheckCircle },
  'people-deactivated': { glyph: UserMinus },

  // — Board display states —
  // Named for the state they mark, not their glyph (iconography.md): the empty board's warm
  // tray and the error state's warning, kept distinct from the priority/backlog roles that
  // happen to share the same glyph today.
  'board-empty': { glyph: Tray },
  'board-error': { glyph: Warning },

  // — Feedback (toast) —
  'toast-success': { glyph: CheckCircle },
  'toast-error': { glyph: WarningCircle },
  retry: { glyph: ArrowClockwise },
} as const satisfies Record<string, RegistryEntry>

// The semantic role a call site names. Deriving it from the registry keeps the union and
// the data in lockstep — a new row is instantly a valid `name`, a removed row a type error.
export type IconRole = keyof typeof ICON_REGISTRY
