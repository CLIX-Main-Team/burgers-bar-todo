import type { KnowledgeCategory, KnowledgeDocSummary } from '@burgers/shared'
import { type ReactNode, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { knowledgeCategoryLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { useKnowledgeDocs } from './use-knowledge-docs.js'

// The Knowledge Base browser (ADR-0024), recut to The Counter's Drive grammar (round 8,
// 2026-08-14, the owner's third take on the folder look): the shelves as compact HORIZONTAL
// folder tiles — folder glyph in a gold-washed square, name and count beside it — under a
// small FOLDERS overline, with the freshest documents as rows in one bordered group below
// (RECENT DOCUMENTS). Inside a shelf, its documents list in those same rows. The filing is
// the categorizer's, read as plain data here; a doc still awaiting its sweep shows under
// General rather than vanishing. Every row links to the original in Drive (the tab is a
// mirror's index, never an editor), and a `skipped` doc is shown with the reason the sync
// recorded instead of being hidden.

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

// The short format chip beside each doc — the Drive mime types the sync ingests (ADR-0023
// formats). An unlisted mime renders no chip rather than a wrong one.
const EXTENSION_BY_MIME: Record<string, string> = {
  'application/vnd.google-apps.document': 'DOC',
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'text/html': 'HTML',
}

const driveUrl = (driveFileId: string) => `https://drive.google.com/file/d/${driveFileId}/view`

// A doc awaiting the categorizer's next sweep files under the General shelf meanwhile.
const shelfOf = (doc: KnowledgeDocSummary): KnowledgeCategory => doc.category ?? 'general'

// How many rows the root's RECENT DOCUMENTS group shows — the artifact's four.
const RECENT_COUNT = 4

// The small uppercase group label over the folder grid and the document rows.
function Overline({ children }: { children: ReactNode }) {
  return (
    <p className="text-caption font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

export function KnowledgeBrowser() {
  const t = useTranslations()
  const { locale } = useLocale()
  const query = useKnowledgeDocs()
  const [shelf, setShelf] = useState<KnowledgeCategory | null>(null)
  const [search, setSearch] = useState('')

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">{t('common.working')}</p>
  }
  if (query.isError) {
    return <Alert tone="error">{t('knowledge.loadFailed')}</Alert>
  }

  const { docs, lastSyncAt } = query.data
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))

  const syncLine = lastSyncAt
    ? t('knowledge.lastSync', { time: formatDate(lastSyncAt) })
    : t('knowledge.neverSynced')

  // A doc matches on its own title or on its shelf's name — a manager typing a category
  // word expects that shelf's contents.
  const needle = search.trim().toLowerCase()
  const matches = needle
    ? docs.filter(
        (doc) =>
          doc.title.toLowerCase().includes(needle) ||
          t(knowledgeCategoryLabelKey(shelfOf(doc)))
            .toLowerCase()
            .includes(needle),
      )
    : []

  const recent = [...docs]
    .sort((a, b) => b.driveModifiedTime.localeCompare(a.driveModifiedTime))
    .slice(0, RECENT_COUNT)

  return (
    <div className="flex flex-col gap-4.5">
      {/* The Counter header grammar: the name and freshness line own the top, the search
          sits in the toolbar row beneath them (full-width on the phone). */}
      <div className="flex flex-col items-start gap-[13px]">
        <div>
          <h1 className="text-heading-lg font-extrabold text-foreground">
            {t('knowledge.heading')}
          </h1>
          <p className="mt-0.5 text-label text-muted-foreground">
            {t('knowledge.docCount', { count: docs.length })} · {syncLine}
          </p>
        </div>
        {docs.length > 0 && shelf === null ? (
          <div className="relative w-full md:w-[280px]">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted-foreground">
              <Icon name="search" size="sm" />
            </span>
            <Input
              type="search"
              aria-label={t('knowledge.searchPlaceholder')}
              placeholder={t('knowledge.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 ps-9 text-label md:text-label"
            />
          </div>
        ) : null}
      </div>

      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('knowledge.empty')}</p>
      ) : shelf === null ? (
        needle === '' ? (
          <>
            <div className="flex flex-col gap-2.5">
              <Overline>{t('knowledge.foldersLabel')}</Overline>
              <ShelfGrid docs={docs} onOpen={setShelf} />
            </div>
            {recent.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                <Overline>{t('knowledge.recentLabel')}</Overline>
                <DocRows docs={recent} formatDate={formatDate} />
              </div>
            ) : null}
          </>
        ) : matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('knowledge.noResults')}</p>
        ) : (
          <DocRows docs={matches} formatDate={formatDate} />
        )
      ) : (
        <ShelfContents
          shelf={shelf}
          docs={docs.filter((doc) => shelfOf(doc) === shelf)}
          formatDate={formatDate}
          onBack={() => setShelf(null)}
        />
      )}
    </div>
  )
}

// The root: every fixed shelf as a Drive-style horizontal tile — folder glyph in a
// gold-washed square, name, live count, in a responsive grid. Empty shelves render too:
// the seven shelves ARE the organization, and a stable grid teaches it at a glance.
function ShelfGrid({
  docs,
  onOpen,
}: {
  docs: KnowledgeDocSummary[]
  onOpen: (shelf: KnowledgeCategory) => void
}) {
  const t = useTranslations()
  const counts = new Map<KnowledgeCategory, number>()
  for (const doc of docs) {
    counts.set(shelfOf(doc), (counts.get(shelfOf(doc)) ?? 0) + 1)
  }

  return (
    <ul className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {CATEGORY_ORDER.map((category) => {
        const count = counts.get(category) ?? 0
        return (
          <li key={category}>
            <button
              type="button"
              onClick={() => onOpen(category)}
              className="flex min-h-[var(--bb-touch-min)] w-full items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3 text-start shadow-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-accent-foreground">
                <Icon name="folder" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-foreground">
                  {t(knowledgeCategoryLabelKey(category))}
                </span>
                {/* One line always — a wrapped count makes neighbouring tiles ragged. */}
                <span className="block truncate text-caption text-muted-foreground">
                  {count === 0
                    ? t('knowledge.categoryEmpty')
                    : t('knowledge.categoryDocCount', { count })}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// Inside one shelf: a back affordance and the shelf's name, then its documents in the same
// rows the root's recent group draws.
function ShelfContents({
  shelf,
  docs,
  formatDate,
  onBack,
}: {
  shelf: KnowledgeCategory
  docs: KnowledgeDocSummary[]
  formatDate: (iso: string) => string
  onBack: () => void
}) {
  const t = useTranslations()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <Icon name="back" size="sm" />
          {t('knowledge.backToCategories')}
        </Button>
      </div>
      <h2 className="text-heading-sm font-semibold text-foreground">
        {t(knowledgeCategoryLabelKey(shelf))}
      </h2>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('knowledge.emptyCategory')}</p>
      ) : (
        <DocRows docs={docs} formatDate={formatDate} />
      )}
    </div>
  )
}

// A group of document rows in one bordered surface — the artifact's krows. Each row links
// straight to the original in Drive, new tab; editing lives in Drive, and the sync brings
// the change back on its own.
function DocRows({
  docs,
  formatDate,
}: {
  docs: KnowledgeDocSummary[]
  formatDate: (iso: string) => string
}) {
  const t = useTranslations()
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {docs.map((doc) => {
        const extension = EXTENSION_BY_MIME[doc.sourceMimeType]
        return (
          <li key={doc.id}>
            <a
              href={driveUrl(doc.driveFileId)}
              target="_blank"
              rel="noreferrer"
              title={t('knowledge.openInDrive')}
              className="flex min-h-11 items-center gap-3 px-3.5 py-2.5 hover:bg-muted/50"
            >
              <span className="grid size-[30px] flex-none place-items-center rounded-[7px] bg-accent text-accent-foreground">
                <Icon name="knowledge-doc" size="sm" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-semibold text-foreground" dir="auto">
                  {doc.title}
                </span>
                {/* Each fragment is bidi-isolated: under RTL the Latin format chip otherwise
                    pulls the shelf name's first word into its own run. */}
                <span className="truncate text-caption text-muted-foreground">
                  {extension ? (
                    <>
                      <bdi>{extension}</bdi>
                      {' · '}
                    </>
                  ) : null}
                  <bdi>{t(knowledgeCategoryLabelKey(shelfOf(doc)))}</bdi>
                  {doc.skipReason ? (
                    <>
                      {' · '}
                      <bdi>{doc.skipReason}</bdi>
                    </>
                  ) : null}
                </span>
              </span>
              <span className="flex-none text-caption text-muted-foreground">
                <bdi>{formatDate(doc.driveModifiedTime)}</bdi>
              </span>
              {doc.status === 'skipped' ? (
                <Badge variant="warning">{t('knowledge.skippedBadge')}</Badge>
              ) : null}
            </a>
          </li>
        )
      })}
    </ul>
  )
}
