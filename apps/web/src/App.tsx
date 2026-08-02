import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import { AcceptScreen } from './routes/accept.js'
import { AppShell } from './routes/app-shell.js'
import { RequireAnon, RequireAuth } from './routes/guards.js'
import { LoginScreen } from './routes/login.js'
import { ResetConsumeScreen } from './routes/reset-consume.js'
import { ResetRequestScreen } from './routes/reset-request.js'

// The reset email links to /reset?token=… (apps/api invite/reset services), the same
// path the "forgot password" link opens without a token. One route serves both: a token
// in the link means the user is setting a new password (consume); no token means they are
// asking for a link (request). This mirrors the API's single reset path.
function ResetRoute() {
  const [params] = useSearchParams()
  return params.get('token') ? <ResetConsumeScreen /> : <ResetRequestScreen />
}

// The SPA route table (ui-flow, routing). The four pre-auth screens are unauthenticated
// routes; the app itself sits behind the session. Accept and reset are reached only via
// their one-time links and are left ungated so those links always open; login and the
// app are guarded so an authenticated user is sent into the app and an unauthenticated
// one to login.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <RequireAnon>
              <LoginScreen />
            </RequireAnon>
          }
        />
        <Route path="/accept" element={<AcceptScreen />} />
        <Route path="/reset" element={<ResetRoute />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        />
        {/* Any unknown path falls back to the app, which itself redirects to login when
            there is no session. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
