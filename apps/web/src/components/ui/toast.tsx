import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'use-intl'
import { cn } from '../../lib/cn.js'
import { EXIT_MS } from '../../lib/motion.js'
import { Icon } from './icon.js'

// The app's voice for something that failed while nobody was looking at it (round 15,
// 2026-08-31). It exists because optimistic writes need it: a change that shows instantly and
// is then refused by the server has to un-show itself, and a row quietly reverting with no
// explanation is worse than the wait it replaced. The reversal is visible, and this says why.
//
// Deliberately NOT a general notification system. Nothing here queues success chatter for
// every save — an action that worked is reported by the thing it changed, which the reader is
// already looking at. A toast is for the case where the screen alone cannot tell the story.
//
// The inline Alert band the board uses for a failed drag stays where it is: it is bound to one
// surface and scrolls with it. This is for failures whose surface may no longer be on screen.

export type ToastTone = 'error' | 'info'

/** How long a toast stays before it starts leaving. Four seconds is the middle of the 3-5s
 *  band: long enough to read a sentence twice, short enough that it is gone before it becomes
 *  furniture. A toast is never the only record of anything, so nothing is lost when it goes. */
const DISPLAY_MS = 4000

/** How many are shown at once. Past three the stack is taller than it is useful, and the
 *  oldest is the one the reader has already had the longest to see. */
const MAX_VISIBLE = 3

interface ToastRecord {
  id: number
  message: string
  tone: ToastTone
  leaving: boolean
}

interface ToastApi {
  show(message: string, tone?: ToastTone): void
}

const ToastContext = createContext<ToastApi | null>(null)

/**
 * Read the toast API. Throws rather than returning a no-op when the provider is missing: a
 * failure that silently reports nothing is the exact bug this component exists to prevent.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used within a ToastProvider')
  return api
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const nextId = useRef(0)
  // Every pending timer, so a provider unmounting mid-flight (a test, a hot reload) leaves
  // nothing behind to fire against a torn-down tree.
  const timers = useRef<number[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) window.clearTimeout(timer)
    }
  }, [])

  const later = useCallback((ms: number, run: () => void) => {
    const timer = window.setTimeout(run, ms)
    timers.current.push(timer)
  }, [])

  const dismiss = useCallback(
    (id: number) => {
      // Two steps, because a toast has to stay mounted to animate out — the same problem the
      // modals solve with useExitTransition, solved inline here because the record already
      // exists and can simply carry the flag.
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      )
      later(EXIT_MS, () => setToasts((current) => current.filter((toast) => toast.id !== id)))
    },
    [later],
  )

  const show = useCallback(
    (message: string, tone: ToastTone = 'error') => {
      const id = nextId.current++
      setToasts((current) =>
        [...current, { id, message, tone, leaving: false }].slice(-MAX_VISIBLE),
      )
      later(DISPLAY_MS, () => dismiss(id))
    },
    [later, dismiss],
  )

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[]
  onDismiss(id: number): void
}) {
  const t = useTranslations()

  return createPortal(
    // Mounted whether or not anything is in it: a live region has to be in the document
    // BEFORE content lands in it, or the first announcement is the one that gets missed.
    //
    // Above the modals rather than beside them (z-60 over their z-50). A write that failed
    // was very often started from inside a dialog, and reporting it underneath that dialog
    // would put the explanation behind the thing it explains.
    //
    // The bottom offset clears the phone's tab bar, which is a row of the shell rather than
    // an overlay, plus whatever the device itself takes below it. From md the bar is gone
    // and only the device's inset is left to pay.
    <div
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4',
        'bottom-[calc(4.25rem+var(--bb-safe-bottom))] md:bottom-[calc(1.5rem+var(--bb-safe-bottom))]',
      )}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full max-w-[26rem] items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-body shadow-lg',
            toast.tone === 'error'
              ? 'border-destructive/40 bg-destructive-muted text-destructive-muted-foreground'
              : 'border-border bg-popover text-popover-foreground',
            toast.leaving ? 'motion-safe:animate-toast-out' : 'motion-safe:animate-toast-in',
          )}
        >
          {/* The two feedback roles the icon registry has carried since the DS was written
              (iconography.md, "Feedback (toast)") and nothing had yet claimed. */}
          <Icon
            name={toast.tone === 'error' ? 'toast-error' : 'toast-success'}
            size="sm"
            className="mt-px flex-none"
          />
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => onDismiss(toast.id)}
            className="-me-1 flex-none rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
