import { cn } from '../../lib/cn.js'

// The branch's initial on the brand black in gold — the artifact's branch disc; decorative,
// the name beside it carries the meaning. Its own module (round 12) because both the branch
// list (location-management.tsx) and the branch detail page (branch-screen.tsx) open on the
// same disc for the same branch.
//
// The ground is --color-brand-black, not --color-nav-surface. Those two are the same ink in
// the dark theme, which is what hid the bug: in the light theme nav-surface is a near-white
// cream, so gold on it fell to about 2:1 and the disc read as an empty circle. The assistant
// mark was fixed the same way, which is why the named token exists at all.
export function BranchDisc({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      dir="auto"
      className={cn(
        'grid size-8 flex-none place-items-center rounded-full bg-brand-black text-caption font-extrabold text-nav-gold',
        className,
      )}
    >
      {name.trim().charAt(0).toLocaleUpperCase()}
    </span>
  )
}
