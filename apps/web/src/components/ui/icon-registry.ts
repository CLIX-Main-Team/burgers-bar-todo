import {
  ArrowClockwise,
  ArrowLeft,
  ArrowSquareOut,
  BookOpenText,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChalkboardSimple,
  ChatCircleDots,
  ChatsCircle,
  Check,
  CheckCircle,
  Circle,
  CircleHalf,
  Clock,
  Confetti,
  DotsSixVertical,
  DotsThree,
  Eye,
  EyeSlash,
  File,
  FileDoc,
  FileHtml,
  FilePdf,
  FileText,
  FileXls,
  Flag,
  Folder,
  ForkKnife,
  Gear,
  type Icon as Glyph,
  Hammer,
  Handshake,
  House,
  type IconWeight,
  IdentificationBadge,
  Info,
  ListChecks,
  MagnifyingGlass,
  MapPin,
  Megaphone,
  Moon,
  Moped,
  NotePencil,
  Package,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Prohibit,
  Receipt,
  SealCheck,
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
  Wrench,
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
// stays put in RTL. `defaultWeight` is the resting weight, `regular` for every role
// but one — `fill` is reserved as the active/selected signal and is applied by the wrapper's
// `active` prop, not stored here (Weight, iconography.md).
export interface RegistryEntry {
  glyph: Glyph
  directional?: boolean
  defaultWeight?: IconWeight
}

export const ICON_REGISTRY = {
  // — Navigation & chrome —
  dashboard: { glyph: House }, // regular -> fill when the destination is active
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
  role: { glyph: IdentificationBadge }, // the board's role filter (2026-08-21)
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
  // The three-way priority MARK the task form's picker wears (2026-08-21). Deliberately not
  // the Warning triangle above: that one is an alert on a card — "this one is urgent" — while
  // this is a value in a list of three, and a triangle has no low. One flag in three inks, the
  // high one filled, always beside its own word so nothing is said in colour alone.
  priority: { glyph: Flag },
  'sort-priority': { glyph: SortAscending }, // the board's priority-lens toggle
  'due-date': { glyph: CalendarBlank },
  overdue: { glyph: Clock },
  backlog: { glyph: Tray },
  edit: { glyph: PencilSimple },
  delete: { glyph: Trash },
  drag: { glyph: DotsSixVertical },
  overflow: { glyph: DotsThree }, // the card's quiet actions menu (Edit / Move to / Delete)
  // The task sheet's knowledge scan (owner call 2026-08-27): read the company's own documents for
  // a checklist this task's title is already covered by. An open book rather than the magnifying
  // glass `search` already holds — that one filters the list in front of you, this one goes and
  // looks something up in the company's own writing. Shape-symmetric, so it never mirrors in RTL.
  // The one role that does not rest at `regular`: beside an extrabold 25px title a hairline glyph
  // drew at a two-thirds-pixel stroke and read as a disabled decoration rather than a control.
  // Bold gives it enough ink to be an affordance without making it louder than the title.
  'checklist-scan': { glyph: BookOpenText, defaultWeight: 'bold' },
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

  // — Knowledge file types (2026-08-23) —
  // One role per FORMAT the sync ingests (ADR-0023), so a document row is scannable by shape
  // before it is read: forty rows wearing one glyph is a list, forty rows wearing their own is
  // a file browser. Each is paired with a --filetype-* ink in file-type.ts; the role names the
  // format, never the colour. Named for the format rather than the Phosphor glyph, so the day
  // Drive starts serving Google Sheets natively `file-sheet` absorbs it as a registry edit.
  // Every glyph carries its letters inside the page silhouette and is shape-symmetric, so none
  // of them mirrors in RTL — a mirrored PDF mark would read as a mirrored word.
  'file-doc': { glyph: FileDoc }, // Google Doc and .docx — the format the corpus is mostly made of
  'file-pdf': { glyph: FilePdf },
  'file-sheet': { glyph: FileXls },
  'file-web': { glyph: FileHtml },
  'file-generic': { glyph: File }, // an ingested format with no mark of its own yet

  // Marks a link that leaves the app for the original in Drive. Its own role rather than a
  // borrowed arrow: `back`/`send` are directional reading arrows, while this one points
  // out of the page in a fixed diagonal and must NOT mirror — a flipped box-arrow reads as
  // an import, the opposite of what the row does.
  'open-external': { glyph: ArrowSquareOut },

  // The Knowledge breadcrumb's separator. Directional, unlike the shape-symmetric marks
  // above: it points along the reading direction, so in Hebrew the trail runs right to left.
  'breadcrumb-separator': { glyph: CaretRight, directional: true },
  'grounded-refusal': { glyph: Info },

  // — Project kinds —
  // A project's glyph names WHAT KIND of work it is, and nothing else: its colour says which
  // project it is (the identity tone), its rail says how far along, its date says when. One
  // channel, one meaning. Every glyph here is shape-symmetric, so none of them mirrors in RTL.
  'project-menu': { glyph: ForkKnife }, // a menu change: new dishes, prices, a seasonal card
  'project-opening': { glyph: Storefront }, // standing a new branch up
  'project-audit': { glyph: SealCheck }, // kashrut, health, safety — anything that gets certified
  'project-equipment': { glyph: Wrench }, // registers, ovens, the fit-out of a room
  'project-training': { glyph: ChalkboardSimple }, // onboarding and shift-crew training
  'project-marketing': { glyph: Megaphone }, // campaigns and anything the guest sees first
  'project-delivery': { glyph: Moped }, // couriers, aggregators, anything that leaves the branch
  'project-hiring': { glyph: Handshake }, // recruiting and onboarding a person, not a skill
  'project-finance': { glyph: Receipt }, // budgets, pricing, anything that ends in a number
  'project-maintenance': { glyph: Hammer }, // the building itself — plumbing, aircon, paint
  'project-supplies': { glyph: Package }, // suppliers, stock and what arrives on the pallet
  'project-event': { glyph: Confetti }, // a launch night, a holiday push, a one-off

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
