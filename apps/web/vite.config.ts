import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig, loadEnv } from 'vite'

// The strict Content-Security-Policy is the load-bearing defence for the
// JavaScript-reachable bearer token (ADR-0006, engineering-design): with no httpOnly
// backstop, script-src 'self' is what stops an injected script from exfiltrating the
// stored session. In production the enforcing copy is a response header set by the
// Render static site; this meta tag is the same policy carried in the built index.html
// so it travels with the bundle and is exercised in `vite preview`.
//
// It is injected at build only. The dev server is deliberately left uncovered: Vite's
// react-refresh preamble is an inline script that script-src 'self' would block, and
// dev is not the surface the token ships on. connect-src is opened to the API origin
// (VITE_API_BASE_URL) because the SPA calls the API cross-origin with the bearer.
function cspMeta(apiBaseUrl: string): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // Tailwind and inline style attributes need 'unsafe-inline' for styles; this does
    // not weaken the script protection that guards the token.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self' ${apiBaseUrl}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'burgers-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      )
    },
  }
}

// The SPA dev server runs on a split origin from the API (default 5173 vs 3000)
// so CORS and the bearer path are exercised in development (ADR-0010).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBaseUrl = env.VITE_API_BASE_URL ?? ''
  return {
    plugins: [react(), tailwindcss(), cspMeta(apiBaseUrl)],
    server: {
      port: 5173,
    },
  }
})
