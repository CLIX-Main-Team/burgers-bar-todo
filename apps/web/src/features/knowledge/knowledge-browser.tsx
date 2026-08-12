import type { KnowledgeCategory, KnowledgeDocSummary } from '@burgers/shared'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { knowledgeCategoryLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { useKnowledgeDocs } from './use-knowledge-docs.js'

// The Knowledge Base browser (ADR-0024): the Drive corpus as a tidy two-level drive — category
// shelves at the root, the shelf's documents inside — where Drive itself is one flat pile. The
// filing is the categorizer's, read as plain data here; a doc still awaiting its sweep shows
// under General rather than vanishing. Every row links to the original in Drive (the tab is a
// mirror's index, never an editor), and a `skipped` doc is shown with the reason the sync
// recorded instead of being hidden — "the Assistant can't read this" is exactly what a manager
// comes here to learn.
//
// The root is a folder grid, not a list (owner direction 2026-08-12, after a recipe-app
// reference): every fixed shelf as a tappable folder tile, three across on a phone, empty
// shelves visible so the taxonomy itself is legible. A search field sits above the grid and
// live-filters titles across every shelf — the whole corpus is already on the client in one
// response, so matching costs nothing and needs no backend.

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

  // A doc matches on its own title or on its shelf's name — the reference pattern searches
  // "folders and more", and a manager typing a category word expects that shelf's contents.
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

  return (
    <div className="flex flex-col gap-6">
      {/* One header block, two postures: a column on the phone (title, then a full-width
          search), title-start / search-end on desktop — the content-header pattern the Tasks
          screen set, so the field stops reading as a banner across the wide canvas. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg font-extrabold text-foreground">
            {t('knowledge.heading')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('knowledge.docCount', { count: docs.length })} · {syncLine}
          </p>
        </div>
        {docs.length > 0 && shelf === null ? (
          // A quiet filled field, not a bordered form input — the browser's chrome should
          // recede behind the folders.
          <div className="relative sm:w-72">
            <span className="pointer-events-none absolute inset-y-0 start-3.5 flex items-center text-muted-foreground">
              <Icon name="search" size="md" />
            </span>
            <Input
              type="search"
              aria-label={t('knowledge.searchPlaceholder')}
              placeholder={t('knowledge.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="rounded-lg border-transparent bg-muted ps-11 shadow-none sm:h-11"
            />
          </div>
        ) : null}
      </div>
      {/* No card frame around the browser (owner feedback 2026-08-12): the reference look is
          folders floating on the canvas, and every element below draws its own surface. */}
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('knowledge.empty')}</p>
      ) : shelf === null ? (
        <div className="flex flex-col gap-4">
          {needle === '' ? (
            <ShelfGrid docs={docs} onOpen={setShelf} />
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('knowledge.noResults')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {matches.map((doc) => (
                <li key={doc.id}>
                  <DocRow doc={doc} formatDate={formatDate} />
                </li>
              ))}
            </ul>
          )}
        </div>
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

// The root: every fixed shelf as a folder tile in a phone-first grid — the mental model is
// "open the folder", not "apply a filter". Empty shelves render too (caption says so): the
// seven shelves ARE the organization, and a stable grid teaches it at a glance.
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
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-4">
      {CATEGORY_ORDER.map((category) => {
        const count = counts.get(category) ?? 0
        return (
          <li key={category}>
            <button
              type="button"
              onClick={() => onOpen(category)}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg p-3 text-center hover:bg-muted sm:aspect-square sm:gap-3 sm:p-4"
            >
              {/* The tile grows with the viewport: phone tiles hug their content, desktop
                  tiles square off (aspect-square) around a folder mark that fills them. */}
              <span className="flex size-16 items-center justify-center rounded-lg bg-primary/10 sm:size-28 sm:rounded-xl">
                <Icon name="folder" className="size-8 text-primary sm:size-14" />
              </span>
              <span className="flex w-full min-w-0 flex-col sm:gap-0.5">
                <span className="truncate text-label font-medium text-foreground sm:text-body">
                  {t(knowledgeCategoryLabelKey(category))}
                </span>
                {/* One line always — a wrapped count makes neighbouring tiles ragged. */}
                <span className="truncate text-caption text-muted-foreground sm:text-label">
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

// Inside one shelf: a back affordance, then a row per document linking out to Drive.
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
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => (
            <li key={doc.id}>
              <DocRow doc={doc} formatDate={formatDate} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// One document: a link row straight to the original in Drive, new tab — editing lives in
// Drive, and the sync brings the change back on its own.
function DocRow({
  doc,
  formatDate,
}: {
  doc: KnowledgeDocSummary
  formatDate: (iso: string) => string
}) {
  const t = useTranslations()
  const extension = EXTENSION_BY_MIME[doc.sourceMimeType]
  return (
    <a
      href={driveUrl(doc.driveFileId)}
      target="_blank"
      rel="noreferrer"
      title={t('knowledge.openInDrive')}
      className="flex min-h-12 items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted"
    >
      <Icon name="knowledge-doc" size="lg" className="shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-foreground">{doc.title}</span>
        {/* Each fragment is bidi-isolated: under RTL the Latin format chip otherwise pulls
            the date's day number into its own run ("PDF · 30" + "ביולי"). */}
        <span className="truncate text-caption text-muted-foreground">
          {extension ? (
            <>
              <bdi>{extension}</bdi>
              {' · '}
            </>
          ) : null}
          <bdi>{formatDate(doc.driveModifiedTime)}</bdi>
          {doc.skipReason ? (
            <>
              {' · '}
              <bdi>{doc.skipReason}</bdi>
            </>
          ) : null}
        </span>
      </span>
      {doc.status === 'skipped' ? (
        <Badge variant="warning">{t('knowledge.skippedBadge')}</Badge>
      ) : null}
    </a>
  )
}
