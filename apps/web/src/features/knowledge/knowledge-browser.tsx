import type { KnowledgeDocSummary } from '@burgers/shared'
import { type CSSProperties, type ReactNode, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { useRowStagger } from '../../lib/use-row-stagger.js'
import { fileTypeOf, folderTypes } from './file-type.js'
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
// Unchanged, because they were right: every row links to the original in Drive (this is a
// mirror's index, never an editor), and a `skipped` doc is shown with the reason the sync
// recorded instead of being hidden.
//
// What changed on 2026-09-03: the folders ARE the Drive folders. Until now the tab showed seven
// fixed shelves an LLM sorted every document into, which meant the page you opened to find a file
// was organized differently from the Drive you filed it in — you had to know both. The corpus
// moved to a folder-per-department Drive, and the tab now reads that structure straight through:
// the tiles are the folders that exist, named as they are named in Drive, and the list under them
// is the files sitting loose at the top level, in the order Drive stacks them. Nothing on this
// screen has an opinion about where a document belongs any more.

// How the document list is ordered. Two orders, not a menu of six: a document is looked for by
// what changed lately or by its name, and every further axis (format, folder) is already a column
// you can see or a folder you can open.
type Sort = 'recent' | 'name'

const driveUrl = (driveFileId: string) => `https://drive.google.com/file/d/${driveFileId}/view`

// The corpus root is the one "folder" with no name of its own, so null is the whole of its
// identity here — the breadcrumb and the location column both spell it out of the message table
// rather than inventing a slug for it.
type Folder = string | null

// The root's column ladder, written ONCE: the folder tiles, the file cards under them and the
// loading silhouette all read it, so the three bands cannot drift into different column counts
// and make the page jump as it loads.
//
// One-up on the phone: the shell's rail leaves ~310px of content there, and a two-up grid cut
// every name to "Proced…" — the round-8 rule that a name you cannot read is not a name applies at
// 390px too.
//
// The wider steps are measured, not guessed (round 13, trimmed one notch after review). A tile
// spends 88px on the 44px mark and its padding, and a name needs ~175px at the raised 15px step,
// so a tile under ~273px starts clipping. Working back from the shell (the rail plus the frame
// padding cost ~390px of viewport) puts two-up at 940, three-up at 1240 and four-up at 1520. Four
// is the cap: round 13 exists to make these bigger, and a fifth column spends that back.
//
// Every step is an arbitrary `min-[…]` rather than a mix of `sm:`/`lg:` and one `min-[…]`. Mixing
// them silently loses: Tailwind v4 emits the arbitrary variant BEFORE the named breakpoints, so at
// 1920 both `lg:grid-cols-3` and `min-[1500px]:grid-cols-4` matched and the later `lg` rule won —
// the grid stayed three-up with the wide rule inert. Round 8's `xl:grid-cols-4
// min-[1800px]:grid-cols-5` had the same bug and its fifth column never fired once. One ladder of
// arbitrary steps sorts by value and behaves.
const ROOT_GRID =
  'grid grid-cols-1 gap-3 md:gap-3.5 min-[940px]:grid-cols-2 min-[1240px]:grid-cols-3 min-[1520px]:grid-cols-4'

// The shell a folder tile and a file card share. They ARE siblings on this screen — same size,
// same ground, same hover — and the only things that tell them apart are the two that should: the
// mark (a quiet folder glyph vs. the format's own colour) and whether a second line follows.
const CARD_SHELL = [
  'group flex min-h-[var(--bb-touch-min)] w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-start shadow-sm',
  'transition-[background-color,border-color,box-shadow] duration-150 hover:border-border-strong hover:bg-muted/40 hover:shadow-md',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
]

export function KnowledgeBrowser() {
  const t = useTranslations()
  const { locale } = useLocale()
  const query = useKnowledgeDocs()
  // Which folder is open, or null at the root. `undefined` is not a state here: a folder named
  // "" cannot exist in Drive, so null is unambiguously the root.
  const [folder, setFolder] = useState<Folder>(null)
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

  const needle = search.trim().toLowerCase()

  // What the list under the grid holds. The three cases are the three questions being asked:
  //
  //   inside a folder — that folder's files, whether or not you are searching
  //   at the root, browsing — the files sitting loose at the top level, mirroring Drive
  //   at the root, searching — the WHOLE corpus, because a search that stopped at the root's
  //     four loose files would answer "no" about a document that is plainly there
  //
  // The last one is the one worth being deliberate about: searching deliberately breaks the
  // mirror, and the grid yields while it does (below) so the screen never claims to be showing
  // you a folder while it lists things from six.
  const inScope =
    folder !== null
      ? docs.filter((doc) => doc.folder === folder)
      : needle
        ? docs
        : docs.filter((doc) => doc.folder === null)

  // A doc matches on its own name or on its folder's — typing a department name is a reasonable
  // way to ask for its documents, and the folder name is on screen beside every hit so the match
  // never looks unexplained. Inside a folder the folder half is dropped: every row would match it
  // and the filter would quietly do nothing.
  const matching = needle
    ? inScope.filter(
        (doc) =>
          doc.title.toLowerCase().includes(needle) ||
          (folder === null && (doc.folder?.toLowerCase().includes(needle) ?? false)),
      )
    : inScope

  const listed = [...matching].sort((a, b) =>
    sort === 'recent'
      ? b.driveModifiedTime.localeCompare(a.driveModifiedTime)
      : a.title.localeCompare(b.title, locale),
  )

  // Browsing (not searching) the corpus root — the one place the list is a grid of cards.
  const browsingRoot = folder === null && needle === ''

  const openFolder = (next: string) => {
    setFolder(next)
    // The search you ran at the root asked a question about the whole corpus; carrying it into a
    // folder would answer a different one, and silently.
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
                folder === null
                  ? t('knowledge.searchPlaceholder')
                  : t('knowledge.searchInFolder', { folder })
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
          {folder === null && needle === '' ? (
            <section className="flex flex-col gap-2.5">
              <Overline>{t('knowledge.foldersLabel')}</Overline>
              <FolderGrid docs={docs} onOpen={openFolder} />
            </section>
          ) : null}

          {/* The root's loose files render only when there ARE some — an empty "Files" heading over
              nothing is noise, and a corpus filed entirely into folders is the tidy case, not a
              broken one. Inside a folder and while searching the section always renders, because
              there the absence of rows is itself the answer. */}
          {folder !== null || needle !== '' || listed.length > 0 ? (
            <section className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                {folder === null ? (
                  <Overline>
                    {needle === '' ? t('knowledge.filesLabel') : t('knowledge.resultsLabel')}
                    <span className="ms-1.5 font-semibold tabular-nums text-foreground">
                      {listed.length}
                    </span>
                  </Overline>
                ) : (
                  <Breadcrumb
                    folder={folder}
                    count={listed.length}
                    onRoot={() => setFolder(null)}
                  />
                )}
                {listed.length > 1 ? <SortTabs sort={sort} onSort={setSort} /> : null}
              </div>

              {listed.length === 0 ? (
                <p className="text-body text-muted-foreground">
                  {needle !== '' ? t('knowledge.noResults') : t('knowledge.emptyFolder')}
                </p>
              ) : browsingRoot ? (
                // Browsing the root, the loose files are CARDS in the same grid the folders sit
                // in, the way Drive stacks them: two bands of one rhythm rather than a wall of
                // tiles that turns into a table halfway down. There is nothing to put in columns
                // here anyway — every one of these files has the same location, and its format is
                // already on its mark and in its own filename.
                <FileGrid docs={listed} />
              ) : (
                // Rows everywhere the extra columns earn their width: inside a folder, and in
                // search results, where the hits come from different folders and the location is
                // the column that explains the match.
                <DocRows
                  docs={listed}
                  formatDate={formatDate}
                  formatDateShort={formatDateShort}
                  showFolder={folder === null}
                />
              )}
            </section>
          ) : (
            <p className="text-body text-muted-foreground">{t('knowledge.noLooseFiles')}</p>
          )}
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
  folder,
  count,
  onRoot,
}: {
  folder: string
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
          {/* The folder's own Drive name. dir="auto" because it is user content, not UI copy:
              the corpus is Hebrew but a folder named in English must not be dragged into the
              surrounding RTL run. */}
          <span
            dir="auto"
            aria-current="page"
            className="truncate text-body font-semibold text-foreground"
          >
            {folder}
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

// The Drive folders as tiles. The set is whatever Drive holds, not a fixed list: a folder added
// in Drive appears here after the next sync and one deleted stops being rendered, with no code to
// change. That is the whole point of the tab being a mirror. A folder Drive has but that holds no
// ingestible file simply never reaches the client, because the listing is of documents.
//
// Name order, not the "recently modified" Drive itself defaults to. A wall of tiles is navigated
// by muscle memory, and folders that reshuffle whenever somebody edits a file inside one defeat
// that; the documents underneath keep the recency sort, where it is the useful axis.
function FolderGrid({
  docs,
  onOpen,
}: {
  docs: KnowledgeDocSummary[]
  onOpen: (folder: string) => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  // Row by row, top to bottom; DOM order across a four-up grid is not reading order.
  const folderGrid = useRowStagger<HTMLUListElement>(80)
  const byFolder = new Map<string, KnowledgeDocSummary[]>()
  for (const doc of docs) {
    if (doc.folder === null) {
      continue
    }
    const bucket = byFolder.get(doc.folder)
    if (bucket) {
      bucket.push(doc)
    } else {
      byFolder.set(doc.folder, [doc])
    }
  }
  const folders = [...byFolder.keys()].sort((a, b) => a.localeCompare(b, locale))

  return (
    <ul ref={folderGrid} className={cn('bb-stagger-rows', ROOT_GRID)}>
      {folders.map((name) => {
        const filed = byFolder.get(name) ?? []
        const types = folderTypes(filed)
        return (
          <li key={name}>
            <button type="button" onClick={() => onOpen(name)} className={cn(CARD_SHELL)}>
              <span className="grid size-11 flex-none place-items-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
                <Icon name="folder" size="lg" />
              </span>
              <span className="min-w-0 flex-1">
                {/* The folder's Drive name verbatim. dir="auto" so a Hebrew name renders and
                    truncates from its own end — but that makes the span its own RTL context, and
                    a FULL-WIDTH rtl box pushes its text to the right while the count underneath
                    stays left, so an English UI showed every tile as two loose fragments.
                    `text-start` cannot fix it (inside that box, start IS the right edge). The box
                    hugging its text can: w-fit leaves it at the tile's own reading edge, and
                    max-w-full keeps a long name truncating rather than widening the tile. This is
                    why the row title below looks right without any of this — it is a flex item,
                    which already shrink-wraps. */}
                <span
                  dir="auto"
                  className="block w-fit max-w-full truncate text-heading-sm font-semibold text-foreground"
                >
                  {name}
                </span>
                {/* One line always — a wrapped count makes neighbouring tiles ragged. The marks
                    ride WITH the count rather than at the tile's trailing edge: out there they
                    were taking the width the name needed, and "Procedures & che…" is exactly the
                    failure this grid is supposed to avoid. The count is short, so beside it they
                    cost nothing. */}
                <span className="mt-0.5 flex items-center gap-1.5 text-label tabular-nums text-muted-foreground">
                  <span className="truncate">
                    {filed.length === 0
                      ? t('knowledge.folderEmpty')
                      : t('knowledge.folderDocCount', { count: filed.length })}
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

// The root's loose files as cards, in the folder grid's own ladder — Drive's shape, minus the
// content thumbnail nobody asked for: a card carries the format's mark and the filename, and
// stops. Everything a row would add is already said or worth nothing here. The location is the
// same for every card (that is what makes them root files). The format is on the mark AND at the
// end of the filename, because these come off a Drive where people type the extension. And the
// date is a sorting axis, not a reading one — the tabs above already order by it.
//
// The card is the folder tile's twin on purpose: same shell, same ladder, one line instead of
// two. What separates them is the mark — a file's carries its format's colour, a folder's stays
// neutral — which is the same rule the row list follows, so colour means "format" everywhere on
// this screen and nothing else.
function FileGrid({ docs }: { docs: KnowledgeDocSummary[] }) {
  const t = useTranslations()
  // Row by row, top to bottom; DOM order across a four-up grid is not reading order.
  const fileGrid = useRowStagger<HTMLUListElement>(80)
  return (
    <ul ref={fileGrid} className={cn('bb-stagger-rows', ROOT_GRID)}>
      {docs.map((doc) => {
        const type = fileTypeOf(doc)
        return (
          <li key={doc.id}>
            <a
              href={driveUrl(doc.driveFileId)}
              target="_blank"
              rel="noreferrer"
              className={cn(CARD_SHELL)}
            >
              {/* Decorative: the filename ends in the extension and the mark's glyph carries the
                  format's letters, so nothing here rides on colour alone. */}
              <span
                aria-hidden
                className={cn('grid size-11 flex-none place-items-center rounded-xl', type.tone)}
              >
                <Icon name={type.icon} size="lg" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                {/* dir="auto" with w-fit, never a full-width block: a full-width auto-direction box
                    becomes its own RTL context and strands a Hebrew name at the far edge. */}
                <span
                  dir="auto"
                  title={doc.title}
                  className="block w-fit max-w-full truncate text-heading-sm font-semibold text-foreground"
                >
                  {doc.title}
                </span>
                {/* A skipped doc keeps its badge and its reason here as it does in a row — the one
                    card on this grid worth making taller, because it is the one the Assistant
                    cannot read. */}
                {doc.status === 'skipped' ? (
                  <span className="mt-1 flex min-w-0 flex-col items-start gap-1">
                    <Badge variant="warning">{t('knowledge.skippedBadge')}</Badge>
                    {doc.skipReason ? (
                      <span className="max-w-full truncate text-label text-muted-foreground">
                        <bdi>{doc.skipReason}</bdi>
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              {/* The card leaves the app. The mark rides in on hover and focus rather than sitting
                  on every card at once; the sr-only line says it unconditionally. */}
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

// A group of document rows in one bordered surface. Each row links straight to the original in
// Drive, new tab; editing lives in Drive, and the sync brings the change back on its own.
function DocRows({
  docs,
  formatDate,
  formatDateShort,
  showFolder,
}: {
  docs: KnowledgeDocSummary[]
  formatDate: (iso: string) => string
  formatDateShort: (iso: string) => string
  /** False wherever every row would carry the same location — inside a folder, or browsing the
   *  root, where the rows are by definition the root's own files. */
  showFolder: boolean
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
                  The location column waits for lg — between md and lg the title needs that width
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
                    {showFolder ? (
                      <>
                        {' · '}
                        <bdi>{doc.folder ?? t('knowledge.rootLocation')}</bdi>
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
                {showFolder ? (
                  // <bdi> and not dir="auto": this sits INSIDE a Hebrew row, and an isolate is
                  // what keeps a Latin folder name from pulling its neighbours into its own run.
                  <span className="hidden w-[12.5rem] flex-none truncate text-label text-muted-foreground lg:block">
                    <bdi>{doc.folder ?? t('knowledge.rootLocation')}</bdi>
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
        <ul className={ROOT_GRID}>
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
        {/* The second band is the root's file CARDS, not a row list — the silhouette has to be the
            shape that lands, or the page jumps the moment the corpus arrives. One line, because a
            file card has one. */}
        <ul className={ROOT_GRID}>
          {[0, 1, 2, 3].map((slot) => (
            <li
              key={slot}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <Skeleton className="size-11 flex-none rounded-xl" />
              <Skeleton className="h-3.5 w-full max-w-[11rem]" />
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