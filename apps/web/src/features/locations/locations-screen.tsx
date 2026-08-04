import { LocationManagement } from './location-management.js'

// The `/locations` route's screen. Admin-only, reached from the account menu's "Manage locations"
// entry and gated by RequireAdmin (a manager or employee is bounced to the task board). Presentation
// gating only — the API authorises every /locations request (ADR-0007) — so the screen carries no
// principal-derived logic of its own; it simply renders the management surface into the shell's
// Outlet.
export function LocationsScreen() {
  return <LocationManagement />
}
