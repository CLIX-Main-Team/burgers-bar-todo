import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The shadcn/ui class-merge helper (engineering-design: Tailwind v4 + shadcn/ui
// surface): compose conditional class lists and let later utilities win over earlier
// ones. Every ui primitive below routes its className through this.
//
// tailwind-merge only knows Tailwind's stock utilities, so the design system's named
// type roles (index.css @theme) must be registered as font-size classes — otherwise
// `text-label` reads as an arbitrary text *colour* and a later `text-primary-foreground`
// silently deletes the size.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['caption', 'label', 'body', 'heading-sm', 'heading-md', 'heading-lg', 'display'] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
