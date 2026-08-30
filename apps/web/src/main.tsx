import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { SessionProvider } from './auth/session.js'
import { LocaleProvider } from './i18n/locale.js'
import './index.css'
import { registerBackButton } from './lib/back-button.js'
import { queryClient } from './lib/query-client.js'
import { ThemeProvider } from './theme/theme.js'

// The Android back gesture, attached before the tree renders so it answers on the login screen
// too. A no-op in a browser; see lib/back-button.ts for why the native shell needs it at all.
registerBackButton()

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element #root not found.')
}

// Provider order: server-state client outermost (the session read is a query), then the
// locale/direction provider and the theme provider — the two global preferences stamped
// on <html> — then the session provider that owns the bearer and the current-principal
// read, with the routed app inside.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ThemeProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
)
