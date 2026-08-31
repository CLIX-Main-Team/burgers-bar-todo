import type { KnowledgeCategory, KnowledgeDocSummary } from '@burgers/shared'
import { type CSSProperties, type ReactNode, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { knowledgeCategoryLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { useRowStagger } from '../../lib/use-row-stagger.js'
import { fileTypeOf, shelfTypes } from './file-type.js'
import { useKnowledgeDocs } from './use-knowledge-docs.js'

// The Knowledge Base browser (ADR-0024), recut for design v2 (round 12, 2026-08-23). The tab is a
// read-only index of the shared Drive folder, and the one question it exists to answer is "where
// is that document" — so the recut is aimed entirely at finding, not at decoration.
//
// What changed from round 8, and why:
//
//   Every row wore the same grey page glyph, so forty rows read as texture. Each document now
//   carries its FORMAT as a mark — its own glyph on its own low-alpha ink (file-type.ts) — which
//   is the one property a manager scanning a list sorts by eye. It is also the only place this
//   screen spends colour; folders stay quiet so the marks are legible as a signal.
//
//   The folder tiles were seven identical gold squares distinguished only by their text (and the
//   gold went neutral when v2 recut --accent, so they had drifted to flat grey). A tile now shows
//   the marks of the formats sitting on that shelf, so it says what is inside before you open it.
//
//   Search vanished the moment you opened a folder, which meant backing out to the root to look
//   for anything. It is now always present and scopes to wherever you are standing.
//
//   Only the four freshest documents were reachable outside a folder. The root now carries the
//   whole corpus as one sortable list under the grid, the way a file browser does — the folders
//   are a shortcut into it, never the only door.
//
// Unchanged, because they were right: the filing is the categorizer's and is read here as plain
// data; a doc awaiting its sweep shows under General rather than vanishing; every row links to the
// original in Drive (this is a mirror's index, never an editor); and a `skipped` doc is shown with
// the reason the sync recorded instead of being hidden.

// Root-first display order: the day-to-day shelves first, the General catch-all last.
const CATEGORY_ORDER: readonly KnowledgeCategory[] = [
  'procedures',
  'finance',
  'hr',
  'reports',
  'agreements',
  'menu',
  'general',
]

// How the document list is ordered. Two orders, not a menu of six: a document is looked for by
// what changed lately or by its name, and every further axis (format, shelf) is already a column
// you can see or a folder you can open.
type Sort = 'recent' | 'name'

const driveUrl = (driveFileId: string) => `https://drive.google.com/file/d/${driveFileId}/view`

// A doc awaiting the categorizer's next sweep files under the General shelf meanwhile.
const shelfOf = (doc: KnowledgeDocSummary): KnowledgeCategory => doc.category ?? 'general'

export function KnowledgeBrowser() {
  const t = useTranslations()
  const { locale } = useLocale()
  const query = useKnowledgeDocs()
  const [shelf, setShelf] = useState<KnowledgeCategory | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('recent')

  if (query.isPending) {
    return <KnowledgeLoading />
  }
  if (query.isError) {
    return (
      <Frame>
        <Header docCount={0} syncLine={null} />
        <StatePanel
          icon="board-error"
          title={t('knowledge.loadFailed')}
          body={t('knowledge.errorBody')}
          action={
            <Button variant="secondary" onClick={() => query.refetch()}>
              <Icon name="retry" size="sm" />
              {t('common.retry')}
            </Button>
          }
        />
      </Frame>
    )
  }

  const { docs, lastSyncAt } = query.data
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  // The phone crams format, shelf and date onto one caption line, where the medium date is the
  // fragment that pushes it past the edge — so that line gets the numeric one instead.
  const formatDateShort = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(iso))

  const syncLine = lastSyncAt ? t('knowledge.lastSync', { time: formatDate(lastSyncAt) }) : null

  // Search scopes to wherever you are standing: inside a shelf it searches that shelf, at the root
  // it searches everything. A doc matches on its own title or on its shelf's name — a manager
  // typing a category word expects that shelf's contents — and at the root only, since inside one
  // shelf every doc would match its own shelf's name and the filter would do nothing.
  const inScope = shelf === null ? docs : docs.filter((doc) => shelfOf(doc) === shelf)
  const needle = search.trim().toLowerCase()
  const matching = needle
    ? inScope.filter(
        (doc) =>
          doc.title.toLowerCase().includes(needle) ||
          (shelf === null &&
            t(knowledgeCategoryLabelKey(shelfOf(doc)))
              .toLowerCase()
              .includes(needle)),
      )
    : inScope

  const listed = [...matching].sort((a, b) =>
    sort === 'recent'
      ? b.driveModifiedTime.localeCompare(a.driveModifiedTime)
      : a.title.localeCompare(b.title, locale),
  )

  const openShelf = (next: KnowledgeCategory) => {
    setShelf(next)
    // The search you ran at the root asked a question about the whole corpus; carrying it into a
    // shelf would answer a different one, and silently.
    setSearch('')
  }

  return (
    <Frame>
      <Header
        docCount={docs.length}
        syncLine={syncLine}
        search={
          docs.length > 0 ? (
            <SearchField
              value={search}
              onChange={setSearch}
              label={
                shelf === null
                  ? t('knowledge.searchPlaceholder')
                  : t('knowledge.searchInFolder', {
                      folder: t(knowledgeCategoryLabelKey(shelf)),
                    })
              }
            />
          ) : null
        }
      />

      {docs.length === 0 ? (
        <StatePanel
          icon="board-empty"
          title={t('knowledge.emptyTitle')}
          body={t('knowledge.empty')}
          action={null}
        />
      ) : (
        <>
          {/* The grid is the root's shortcut into the list below it, so it yields while a search
              is running: a folder cannot answer "which document says X". */}
          {shelf === null && needle === '' ? (
            <section className="flex flex-col gap-2.5">
              <Overline>{t('knowledge.foldersLabel')}</Overline>
              <ShelfGrid docs={docs} onOpen={openShelf} />
            </section>
          ) : null}

          <section className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {shelf === null ? (
                <Overline>
                  {t('knowledge.allDocumentsLabel')}
                  <span className="ms-1.5 font-semibold tabular-nums text-foreground">
                    {listed.length}
                  </span>
                </Overline>
              ) : (
                <Breadcrumb shelf={shelf} count={listed.length} onRoot={() => setShelf(null)} />
              )}
              {listed.length > 1 ? <SortTabs sort={sort} onSort={setSort} /> : null}
            </div>

            {listed.length === 0 ? (
              <p className="text-body text-muted-foreground">
                {needle === '' ? t('knowledge.emptyCategory') : t('knowledge.noResults')}
              </p>
            ) : (
              <DocRows
                docs={listed}
                formatDate={formatDate}
                formatDateShort={formatDateShort}
                showShelf={shelf === null}
              />
            )}
          </section>
        </>
      )}
    </Frame>
  )
}

// The screen's one column. Named so the loading, error and loaded states cannot drift apart in
// their spacing — three copies of the same gap is how a page starts to jump between states.
function Frame({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>
}

// The Counter header grammar: the name and freshness line own the start, the search sits opposite
// them on desktop and drops under them on the phone, where a 280px field beside a title would
// leave neither enough room.
function Header({
  docCount,
  syncLine,
  search,
}: {
  docCount: number
  syncLine: string | null
  search?: ReactNode
}) {
  const t = useTranslations()
  return (
    <div className="flex flex-col items-start gap-[13px] motion-safe:animate-rise md:flex-row md:items-end md:justify-between md:gap-4">
      <div className="min-w-0">
        <h1 className="text-heading-lg font-extrabold text-foreground">{t('knowledge.heading')}</h1>
        <p className="mt-0.5 text-body text-muted-foreground">
          <span className="tabular-nums">{t('knowledge.docCount', { count: docCount })}</span>
          {' · '}
          {syncLine ?? t('knowledge.neverSynced')}
        </p>
      </div>
      {search}
    </div>
  )
}

function SearchField({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (next: string) => void
  label: string
}) {
  return (
    <div className="relative w-full md:w-[20rem]">
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted-foreground">
        <Icon name="search" />
      </span>
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 ps-10 md:h-10 md:text-body"
      />
    </div>
  )
}

// The small uppercase group label over the folder grid and the document list.
function Overline({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

// Where you are standing, and the way back. A trail rather than round 8's lone "All categories"
// button: the button said what it would do, this says where you are — which is the thing you
// actually want to know two folders deep, and the affordance every file browser has trained
// people to look for.
function Breadcrumb({
  shelf,
  count,
  onRoot,
}: {
  shelf: KnowledgeCategory
  count: number
  onRoot: () => void
}) {
  const t = useTranslations()
  return (
    <nav aria-label={t('knowledge.breadcrumbLabel')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1">
        <li className="flex-none">
          <button
            type="button"
            onClick={onRoot}
            className="-mx-1 flex min-h-11 items-center rounded-sm px-1 text-body font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-0 md:py-0.5"
          >
            {t('knowledge.heading')}
          </button>
        </li>
        <li aria-hidden className="flex-none text-muted-foreground">
          <Icon name="breadcrumb-separator" />
        </li>
        <li className="flex min-w-0 items-baseline gap-1.5">
          <span aria-current="page" className="truncate text-body font-semibold text-foreground">
            {t(knowledgeCategoryLabelKey(shelf))}
          </span>
          <span className="flex-none text-label tabular-nums text-muted-foreground">{count}</span>
        </li>
      </ol>
    </nav>
  )
}

// The list's order, as two pressed-state tabs rather than a select: with exactly two options a
// menu costs a tap to show you what a pair of words already says. Follows the board's tab
// grammar (status-board.tsx) — a `group` of `aria-pressed` buttons holding the 44px touch floor
// while the visible chip stays text-height.
function SortTabs({ sort, onSort }: { sort: Sort; onSort: (next: Sort) => void }) {
  const t = useTranslations()
  const options: { key: Sort; label: string }[] = [
    { key: 'recent', label: t('knowledge.sortRecent') },
    { key: 'name', label: t('knowledge.sortName') },
  ]
  return (
    // A fieldset rather than a div with role="group", matching the board's status tabs: the
    // implicit role is the same and the element carries it natively.
    <fieldset
      aria-label={t('knowledge.sortLabel')}
      className="m-0 flex items-center gap-0.5 rounded-md border border-border-strong bg-card p-0.5"
    >
      {options.map((option) => {
        const selected = sort === option.key
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSort(option.key)}
            className={cn(
              'flex min-h-11 items-center rounded-md px-2.5 text-label font-semibold whitespace-nowrap transition-colors md:min-h-8',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              selected
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}

// The root's shelves as tiles. Every fixed shelf renders, empty ones included: the seven shelves
// ARE the organization, and a stable grid teaches it at a glance. Each tile carries the marks of
// the formats on that shelf, so it says what kind of thing is inside before you open it.
function ShelfGrid({
  docs,
  onOpen,
}: {
  docs: KnowledgeDocSummary[]
  onOpen: (shelf: KnowledgeCategory) => void
}) {
  const t = useTranslations()
  // Row by row, top to bottom; DOM order across a four-up grid is not reading order.
  const shelfGrid = useRowStagger<HTMLUListElement>(80)
  const byShelf = new Map<KnowledgeCategory, KnowledgeDocSummary[]>()
  for (const doc of docs) {
    const key = shelfOf(doc)
    const bucket = byShelf.get(key)
    if (bucket) {
      bucket.push(doc)
    } else {
      byShelf.set(key, [doc])
    }
  }

  // One-up on the phone: the shell's rail leaves ~310px of content there, and a two-up grid cut
  // every name to "Proced…" — the round-8 rule that a folder you cannot read is not a folder
  // applies at 390px too. Two-up returns at sm, where the names fit again.
  //
  // Column counts here are measured, not guessed (round 13, the scale-up pass, trimmed one notch
  // after review). A tile spends 88px on the 44px glyph and its padding, and the longest shelf
  // name — "Procedures & checklists" at the raised 15px step — needs ~175px, so a tile under
  // ~273px starts clipping names. Working back from the shell (the rail plus the frame padding
  // cost ~390px of viewport), that puts two-up at 940, three-up at 1240 and four-up at 1520.
  // Four is the cap: this pass exists to make the tiles bigger, and a fifth spends that back.
  //
  // Every step is an arbitrary `min-[…]` rather than a mix of `sm:`/`lg:` and one `min-[…]`.
  // Mixing them silently loses: Tailwind v4 emits the arbitrary variant BEFORE the named
  // breakpoints, so at 1920 both `lg:grid-cols-3` and `min-[1500px]:grid-cols-4` matched and the
  // later `lg` rule won — the grid stayed three-up with the wide rule inert. Round 8's
  // `xl:grid-cols-4 min-[1800px]:grid-cols-5` had the same bug and its fifth column never fired.
  // One ladder of arbitrary steps sorts by value and behaves.
  return (
    <ul
      ref={shelfGrid}
      className="bb-stagger-rows grid grid-cols-1 gap-3 md:gap-3.5 min-[940px]:grid-cols-2 min-[1240px]:grid-cols-3 min-[1520px]:grid-cols-4"
    >
      {CATEGORY_ORDER.map((category) => {
        const shelved = byShelf.get(category) ?? []
        const types = shelfTypes(shelved)
        return (
          <li key={category}>
            <button
              type="button"
              onClick={() => onOpen(category)}
              className={cn(
                'group flex min-h-[var(--bb-touch-min)] w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-start shadow-sm',
                'transition-[background-color,border-color,box-shadow] duration-150 hover:border-border-strong hover:bg-muted/40 hover:shadow-md',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <span className="grid size-11 flex-none place-items-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
                <Icon name="folder" size="lg" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-heading-sm font-semibold text-foreground">
                  {t(knowledgeCategoryLabelKey(category))}
                </span>
                {/* One line always — a wrapped count makes neighbouring tiles ragged. The marks
                    ride WITH the count rather than at the tile's trailing edge: out there they
                    were taking the width the name needed, and "Procedures & che…" is exactly the
                    failure this grid is supposed to avoid. The count is short, so beside it they
                    cost nothing. */}
                <span className="mt-0.5 flex items-center gap-1.5 text-label tabular-nums text-muted-foreground">
                  <span className="truncate">
                    {shelved.length === 0
                      ? t('knowledge.categoryEmpty')
                      : t('knowledge.categoryDocCount', { count: shelved.length })}
                  </span>
                  {/* A texture read, not a data point — the count beside it is the number, and
                      these say what shape it is. */}
                  {types.length > 0 ? (
                    <span aria-hidden className="flex flex-none items-center gap-1">
                      {types.map((type) => (
                        <span
                          key={type.icon}
                          className={cn(
                            'grid size-[1.375rem] place-items-center rounded-md',
                            type.tone,
                          )}
                        >
                          <Icon name={type.icon} size="sm" />
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// A group of document rows in one bordered surface. Each row links straight to the original in
// Drive, new tab; editing lives in Drive, and the sync brings the change back on its own.
function DocRows({
  docs,
  formatDate,
  formatDateShort,
  showShelf,
}: {
  docs: KnowledgeDocSummary[]
  formatDate: (iso: string) => string
  formatDateShort: (iso: string) => string
  /** False inside a shelf, where every row would repeat the folder name you just opened. */
  showShelf: boolean
}) {
  const t = useTranslations()
  return (
    <ul
      className="bb-stagger divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      style={{ '--bb-stagger-base': '80ms' } as CSSProperties}
    >
      {docs.map((doc) => {
        const type = fileTypeOf(doc)
        return (
          <li key={doc.id}>
            <a
              href={driveUrl(doc.driveFileId)}
              target="_blank"
              rel="noreferrer"
              className="group flex min-h-[3.25rem] items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {/* The format mark — the one place this screen spends colour. Decorative: the abbr
                  on the row's second line says the same thing in words, so the format survives
                  greyscale and a screen reader alike. */}
              <span
                aria-hidden
                className={cn(
                  'grid size-9 flex-none place-items-center rounded-[0.5rem]',
                  type.tone,
                )}
              >
                <Icon name={type.icon} />
              </span>
              {/* One line with aligned columns from md, stacked from below it. Two-line rows are a
                  phone pattern: on a 1400px monitor they left a 600px void between the title and
                  a stranded date, which is what made the old list read as an unfinished table.
                  The shelf column waits for lg — between md and lg the title needs that width
                  more than the filing does, and the filing is one click away in the grid. */}
              <span className="flex min-w-0 flex-1 flex-col items-start md:flex-row md:items-center md:gap-3">
                <span className="flex min-w-0 max-w-full flex-col items-start md:flex-1">
                  <span className="flex min-w-0 max-w-full items-center gap-2">
                    {/* plaintext, not dir="auto" and not <bdi> (2026-08-16, see thread-list.tsx
                        for the same call): the title keeps its own paragraph direction, so it
                        renders and truncates from its own end, while text-start holds it on the
                        row's reading edge beside its mark rather than stranding it across the
                        row. */}
                    <span
                      dir="auto"
                      // A long Drive filename truncates in the narrower columns, and the row's
                      // whole job is telling you which file this is — so the full name stays
                      // reachable on hover rather than only after you have opened it.
                      title={doc.title}
                      className="min-w-0 truncate text-heading-sm font-semibold text-foreground"
                    >
                      {doc.title}
                    </span>
                    {doc.status === 'skipped' ? (
                      <Badge variant="warning" className="flex-none">
                        {t('knowledge.skippedBadge')}
                      </Badge>
                    ) : null}
                  </span>
                  {/* The phone's meta line, carrying the same three columns the desktop row
                      spreads out. Each fragment is bidi-isolated: under RTL the Latin format
                      word otherwise pulls the shelf name's first word into its own run. */}
                  <span className="mt-0.5 max-w-full truncate text-label text-muted-foreground md:hidden">
                    <bdi>{type.abbr}</bdi>
                    {showShelf ? (
                      <>
                        {' · '}
                        <bdi>{t(knowledgeCategoryLabelKey(shelfOf(doc)))}</bdi>
                      </>
                    ) : null}
                    {' · '}
                    <bdi>{formatDateShort(doc.driveModifiedTime)}</bdi>
                  </span>
                  {/* Why the Assistant cannot read this one. It keeps its own line in both
                      layouts — a skipped doc is the one row on the page worth making taller. */}
                  {doc.skipReason ? (
                    <span className="mt-0.5 max-w-full truncate text-label text-muted-foreground">
                      <bdi>{doc.skipReason}</bdi>
                    </span>
                  ) : null}
                </span>
                <span className="hidden w-[4rem] flex-none text-label text-muted-foreground md:block">
                  <bdi>{type.abbr}</bdi>
                </span>
                {showShelf ? (
                  <span className="hidden w-[12.5rem] flex-none truncate text-label text-muted-foreground lg:block">
                    <bdi>{t(knowledgeCategoryLabelKey(shelfOf(doc)))}</bdi>
                  </span>
                ) : null}
                <span className="hidden w-[7.5rem] flex-none text-label tabular-nums text-muted-foreground md:block">
                  <bdi>{formatDate(doc.driveModifiedTime)}</bdi>
                </span>
              </span>
              {/* The row leaves the app, and until now only a tooltip said so. The mark rides in
                  on hover and focus rather than sitting on all forty rows at once, and the
                  sr-only line carries the same fact to a screen reader unconditionally. */}
              <span className="flex-none text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                <Icon name="open-external" />
              </span>
              <span className="sr-only">{t('knowledge.openInDrive')}</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

// Silhouettes shaped like the real grid and list rather than a word on a blank screen, so the
// page does not jump when the corpus lands (the pattern projects-screen.tsx uses).
function KnowledgeLoading() {
  const t = useTranslations()
  return (
    <Frame>
      <div>
        <h1 className="text-heading-lg font-extrabold text-foreground">{t('knowledge.heading')}</h1>
        <Skeleton className="mt-2 h-3.5 w-56" />
      </div>
      <div aria-busy="true" aria-label={t('knowledge.loading')} className="flex flex-col gap-5">
        <ul className="grid grid-cols-1 gap-3 md:gap-3.5 min-[940px]:grid-cols-2 min-[1240px]:grid-cols-3 min-[1520px]:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6].map((slot) => (
            <li
              key={slot}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <Skeleton className="size-11 flex-none rounded-xl" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-full max-w-[9rem]" />
                <Skeleton className="h-3 w-20" />
              </div>
            </li>
          ))}
        </ul>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {[0, 1, 2, 3, 4].map((slot) => (
            <li key={slot} className="flex min-h-[3.25rem] items-center gap-3 px-4 py-2.5">
              <Skeleton className="size-9 flex-none rounded-[0.5rem]" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-full max-w-[16rem]" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-3 w-20 flex-none" />
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  )
}

// The screen's empty and error frames, in the shape the board and the roster already use.
function StatePanel({
  icon,
  title,
  body,
  action,
}: {
  icon: 'board-empty' | 'board-error'
  title: string
  body: string
  action: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-12 text-center">
      <Icon name={icon} size="lg" className="size-11 text-muted-foreground" />
      <p className="text-heading-md font-semibold text-foreground">{title}</p>
      <p className="max-w-[42ch] text-heading-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}
