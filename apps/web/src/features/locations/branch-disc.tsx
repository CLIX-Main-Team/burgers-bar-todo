import { cn } from '../../lib/cn.js'

// The branch's initial on the brand black in gold — the artifact's branch disc; decorative,
// the name beside it carries the meaning. Its own module (round 12) because both the branch
// list (location-management.tsx) and the branch detail page (branch-screen.tsx, Task 3) open
// on the same disc for the same branch.
export function BranchDisc({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      dir="auto"
      className={cn(
        'grid size-8 flex-none place-items-center rounded-full bg-nav-surface text-caption font-extrabold text-nav-gold',
        className,
      )}
    >
      {name.trim().charAt(0).toLocaleUpperCase()}
    </span>
  )
}
