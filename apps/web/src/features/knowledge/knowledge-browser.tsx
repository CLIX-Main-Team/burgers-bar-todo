import type { KnowledgeCategory, KnowledgeDocSummary } from '@burgers/shared'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Card } from '../../components/ui/card.js'
import { Icon } from '../../components/ui/icon.js'
import { knowledgeCategoryLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { useKnowledgeDocs } from './use-knowledge-docs.js'

// The Knowledge Base browser (ADR-0024): the Drive corpus as a tidy two-level drive — category
// shelves at the root, the shelf's documents inside — where Drive itself is one flat pile. The
// filing is the categorizer's, read as plain data here; a doc still awaiting its sweep shows
// under General rather than vanishing. Every row links to the original in Drive (the tab is a
// mirror's index, never an editor), and a `skipped` doc is shown with the reason the sync
// recorded instead of being hidden — "the Assistant can't read this" is exactly what a manager
// comes here to learn. One column, row-per-document, so the phone layout is the layout.

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg font-extrabold text-foreground">
          {t('knowledge.heading')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('knowledge.docCount', { count: docs.length })} · {syncLine}
        </p>
      </div>
      <Card>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('knowledge.empty')}</p>
        ) : shelf === null ? (
          <ShelfList docs={docs} onOpen={setShelf} />
        ) : (
          <ShelfContents
            shelf={shelf}
            docs={docs.filter((doc) => shelfOf(doc) === shelf)}
            formatDate={formatDate}
            onBack={() => setShelf(null)}
          />
        )}
      </Card>
    </div>
  )
}

// The root: one row per non-empty shelf, in the fixed order — a folder look-alike, so the
// mental model is "open the folder", not "apply a filter".
function ShelfList({
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
    <ul className="flex flex-col gap-2">
      {CATEGORY_ORDER.filter((category) => counts.has(category)).map((category) => (
        <li key={category}>
          <button
            type="button"
            onClick={() => onOpen(category)}
            className="flex w-full min-h-12 items-center gap-3 rounded-lg border border-border p-3 text-start hover:bg-muted"
          >
            <Icon name="folder" size="lg" className="shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {t(knowledgeCategoryLabelKey(category))}
            </span>
            <span className="shrink-0 text-caption text-muted-foreground">
              {t('knowledge.categoryDocCount', { count: counts.get(category) })}
            </span>
            <Icon name="row-forward" size="sm" className="shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
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
        <span className="truncate text-caption text-muted-foreground">
          {extension ? `${extension} · ` : ''}
          {formatDate(doc.driveModifiedTime)}
          {doc.skipReason ? ` · ${doc.skipReason}` : ''}
        </span>
      </span>
      {doc.status === 'skipped' ? (
        <Badge variant="warning">{t('knowledge.skippedBadge')}</Badge>
      ) : null}
    </a>
  )
}
