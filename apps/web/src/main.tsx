import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { SessionProvider } from './auth/session.js'
import { LocaleProvider } from './i18n/locale.js'
import './index.css'
import { queryClient } from './lib/query-client.js'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element #root not found.')
}

// Provider order: server-state client outermost (the session read is a query), then the
// locale/direction provider, then the session provider that owns the bearer and the
// current-principal read, with the routed app inside.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
)
