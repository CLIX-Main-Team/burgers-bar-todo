import { KnowledgeBrowser } from './knowledge-browser.js'

// The `/knowledge` route's screen (ADR-0024). Manager/admin, gated by RequireProvisioner (an
// employee is bounced to the task board). Presentation gating only — the API authorises every
// /assistant/knowledge request (ADR-0007) — so the screen carries no principal-derived logic
// of its own; it simply renders the browser into the shell's Outlet.
export function KnowledgeScreen() {
  return <KnowledgeBrowser />
}
