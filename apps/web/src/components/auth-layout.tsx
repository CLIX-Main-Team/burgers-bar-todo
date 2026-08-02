import { LanguageToggle } from './language-toggle.js'
import { Card } from './ui/card.js'

// The shared frame for the four pre-auth screens: a centred card with the language
// toggle in the corner, so the toggle is present and consistent on login, accept,
// reset-request, and reset-consume (ui-flow: every pre-auth screen carries the toggle).
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex justify-end">
          <LanguageToggle />
        </div>
        <Card>{children}</Card>
      </div>
    </div>
  )
}
