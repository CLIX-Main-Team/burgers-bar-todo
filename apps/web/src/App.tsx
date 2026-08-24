import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import { AssistantScreen } from './features/assistant/assistant-screen.js'
import { DashboardScreen } from './features/dashboard/dashboard-screen.js'
import { KnowledgeScreen } from './features/knowledge/knowledge-screen.js'
import { BranchScreen } from './features/locations/branch-screen.js'
import { LocationsScreen } from './features/locations/locations-screen.js'
import { PeopleScreen } from './features/people/people-screen.js'
import { ProjectDetailScreen } from './features/projects/project-detail.js'
import { ProjectsScreen } from './features/projects/projects-screen.js'
import { TasksScreen } from './features/tasks/tasks-screen.js'
import { AcceptScreen } from './routes/accept.js'
import { RequireAdmin, RequireAnon, RequireAuth, RequireProvisioner } from './routes/guards.js'
import { LoginScreen } from './routes/login.js'
import { PrivacyScreen } from './routes/privacy.js'
import { ResetConsumeScreen } from './routes/reset-consume.js'
import { ResetRequestScreen } from './routes/reset-request.js'
import { AppLayout } from './shell/app-layout.js'

// The reset email links to /reset?token=… (apps/api invite/reset services), the same
// path the "forgot password" link opens without a token. One route serves both: a token
// in the link means the user is setting a new password (consume); no token means they are
// asking for a link (request). This mirrors the API's single reset path.
//
// The request branch is anon-gated like login (ui-flow, routing: an authenticated user on
// a pre-auth route goes to the app), while the token-bearing consume branch is left
// ungated so a one-time reset link always opens even if a session happens to exist.
function ResetRoute() {
  const [params] = useSearchParams()
  if (params.get('token')) {
    return <ResetConsumeScreen />
  }
  return (
    <RequireAnon>
      <ResetRequestScreen />
    </RequireAnon>
  )
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
        {/* The privacy policy the app store listings point at. Ungated in both directions:
            a store reviewer opens it with no account, and a signed-in user following the
            link should read it rather than be bounced into the app. */}
        <Route path="/privacy" element={<PrivacyScreen />} />
        {/* The shell is a layout route: RequireAuth gates the whole subtree, AppLayout
            draws the header + tab bar once, and each in-app screen renders into its
            Outlet. The index redirects `/` → `/tasks` so landing on the app opens the
            task board (PRD, story 1). */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          {/* The Dashboard is the landing screen (owner call 2026-08-21, replacing the
              redirect straight to the board). It keeps a real path of its own rather than
              living on `/`, so it can be linked and so the rail's active state resolves like
              every other row's. */}
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardScreen />} />
          <Route path="tasks" element={<TasksScreen />} />
          {/* Projects carries NO role guard since projects gained their own roles field: what
              somebody sees is decided entirely by the API's scope predicate from the fresh
              principal — their branch, and the projects naming their role — exactly as the board
              is (ADR-0007). An employee reaches these routes and gets their own, shorter list.
              Creating and editing stay manager-and-up, but that is enforced at the API and
              mirrored by the screen, not by a route. */}
          <Route path="projects" element={<ProjectsScreen />} />
          {/* A project's own page. It gets a real URL rather than a dialog so a project can be
              linked to somebody in a message, which is how the chain actually hands work over. */}
          <Route path="projects/:projectId" element={<ProjectDetailScreen />} />
          <Route path="assistant" element={<AssistantScreen />} />
          <Route
            path="people"
            element={
              <RequireProvisioner>
                <PeopleScreen />
              </RequireProvisioner>
            }
          />
          <Route
            path="knowledge"
            element={
              <RequireProvisioner>
                <KnowledgeScreen />
              </RequireProvisioner>
            }
          />
          <Route
            path="locations"
            element={
              <RequireAdmin>
                <LocationsScreen />
              </RequireAdmin>
            }
          />
          {/* The branch detail page (round 12): a row on the list above navigates here
              rather than opening a Dialog. Same admin gate as the list itself — a branch
              admin reaches their own branch, a super_admin reaches any of them, and the
              API is the actual authority either way (ADR-0007). */}
          <Route
            path="locations/:id"
            element={
              <RequireAdmin>
                <BranchScreen />
              </RequireAdmin>
            }
          />
        </Route>
        {/* Any unknown path falls back to the app, which itself redirects to login when
            there is no session. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
