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
    // heading-md since The Counter (round 8): the pre-auth titles sit inside a compact
    // white card now, where the old display scale shouted.
    <h1
      className={cn('text-heading-md font-extrabold text-card-foreground', className)}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />
}
