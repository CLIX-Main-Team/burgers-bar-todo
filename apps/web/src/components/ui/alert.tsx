import { cn } from '../../lib/cn.js'

// A message banner for the flow outcomes: an error (a generic sign-in failure, a bad
// token), a success/confirmation (the generic reset confirmation), or a neutral notice.
// role="alert" so screen readers announce it when it appears after a submit. Rethemed
// onto the soft status variants (issue #101, components.md Alert): each tone is a tinted
// surface with darker ink so the message text clears 4.5:1 in both themes, and the
// neutral notice reads through the muted surface since there is no info token.
type Tone = 'error' | 'success' | 'info'

const tones: Record<Tone, string> = {
  error: 'border-destructive-muted bg-destructive-muted text-destructive-muted-foreground',
  success: 'border-success-muted bg-success-muted text-success-muted-foreground',
  info: 'border-border bg-muted text-muted-foreground',
}

export function Alert({
  tone = 'info',
  className,
  ...props
}: { tone?: Tone } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      className={cn('rounded-lg border px-3 py-2 text-sm', tones[tone], className)}
      {...props}
    />
  )
}
