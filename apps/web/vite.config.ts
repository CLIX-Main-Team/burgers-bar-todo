import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The SPA dev server runs on a split origin from the API (default 5173 vs 3000)
// so CORS and the bearer path are exercised in development (ADR-0010).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
})
