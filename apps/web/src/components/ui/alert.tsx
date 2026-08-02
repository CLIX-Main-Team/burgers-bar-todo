import { cn } from '../../lib/cn.js'

// A message banner for the flow outcomes: an error (a generic sign-in failure, a bad
// token), a success/confirmation (the generic reset confirmation), or a neutral notice.
// role="alert" so screen readers announce it when it appears after a submit.
type Tone = 'error' | 'success' | 'info'

const tones: Record<Tone, string> = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
}

export function Alert({
  tone = 'info',
  className,
  ...props
}: { tone?: Tone } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      className={cn('rounded-md border px-3 py-2 text-sm', tones[tone], className)}
      {...props}
    />
  )
}
