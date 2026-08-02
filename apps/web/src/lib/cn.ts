import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// The shadcn/ui class-merge helper (engineering-design: Tailwind v4 + shadcn/ui
// surface): compose conditional class lists and let later utilities win over earlier
// ones. Every ui primitive below routes its className through this.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
