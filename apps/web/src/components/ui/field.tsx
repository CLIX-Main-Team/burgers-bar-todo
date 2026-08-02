import { useId } from 'react'
import { cn } from '../../lib/cn.js'

// A labelled form field: label, the control, and an optional hint or error line. It
// wires the label, the control, and the message together by id for assistive tech.
// The control is rendered via a render-prop so the caller supplies the Input/Select and
// spreads the generated id onto it.
interface FieldProps {
  label: string
  hint?: string
  error?: string
  className?: string
  children(props: {
    id: string
    'aria-invalid': boolean
    'aria-describedby'?: string
  }): React.ReactNode
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? hint
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': message ? messageId : undefined,
      })}
      {message ? (
        <p id={messageId} className={cn('text-xs', error ? 'text-red-600' : 'text-slate-500')}>
          {message}
        </p>
      ) : null}
    </div>
  )
}
