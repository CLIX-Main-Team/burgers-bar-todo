import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'

// A lane's pager strip (owner call 2026-08, modelled on the team CRM's per-column board
// pager): ten cards a page, two square step buttons at the strip's outer edges and the
// "{from}–{to} of {total}" range centred between them. Purely presentational — the board owns
// the page state and slices the lane; this only draws the strip and reports the two taps. The
// board renders it only when a lane actually overflows a page, so a short lane carries no
// chrome. The step glyphs are directional registry roles, so they mirror under RTL, and the
// range rides a <bdi> so the numerals hold their order inside a Hebrew sentence.
export const BOARD_PAGE_SIZE = 10

const STEP_BUTTON =
  'inline-grid size-8 flex-none place-items-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ColumnPager({
  page,
  pageCount,
  from,
  to,
  total,
  onPrev,
  onNext,
}: {
  // 0-based current page and the lane's page count, for the step buttons' end stops.
  page: number
  pageCount: number
  // 1-based bounds of the visible slice, for the range text.
  from: number
  to: number
  total: number
  onPrev: () => void
  onNext: () => void
}) {
  const t = useTranslations('tasks')
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-sm">
      <button
        type="button"
        onClick={onPrev}
        disabled={page <= 0}
        aria-label={t('pagerPrev')}
        className={STEP_BUTTON}
      >
        <Icon name="pager-prev" size="sm" />
      </button>
      <span className="min-w-0 truncate text-center text-caption font-semibold tabular-nums text-muted-foreground">
        <bdi>{t('pagerRange', { from, to, total })}</bdi>
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= pageCount - 1}
        aria-label={t('pagerNext')}
        className={STEP_BUTTON}
      >
        <Icon name="pager-next" size="sm" />
      </button>
    </div>
  )
}
