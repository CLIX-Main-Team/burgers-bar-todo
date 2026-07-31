// Walking-skeleton landing screen. The auth screens (login, accept, reset) land
// with their slices; this only proves the SPA boots and reads its one env value,
// the API base URL, from apps/web/.env.local (VITE_API_BASE_URL — ADR-0010).
export function App() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '(unset)'
  return (
    <main>
      <h1>Burgers Bar staff app</h1>
      <p>Foundation skeleton. API base URL: {apiBaseUrl}</p>
    </main>
  )
}
