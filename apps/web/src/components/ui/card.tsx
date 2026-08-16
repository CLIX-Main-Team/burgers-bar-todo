import { cn } from '../../lib/cn.js'

// A raised surface panel framing the pre-auth screens and the in-app sections, rethemed
// onto the tokens (issue #101, components.md Card): the card surface and its foreground,
// a border hairline for borders-first separation, radius-lg, and a soft elevation-sm
// where the panel genuinely lifts off the canvas.
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    // The display role (23px since the 2026-08-14 density pass) — the artifact's login-card
    // title, the largest text a pre-auth card carries.
    <h1 className={cn('text-display font-extrabold text-card-foreground', className)} {...props} />
  )
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-body text-muted-foreground', className)} {...props} />
}
