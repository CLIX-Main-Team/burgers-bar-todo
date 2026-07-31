import { buildApp } from './app.js'
import { loadEnv } from './env.js'
import { loadRootEnv } from './load-env.js'

// Process entry point: build the app and listen. The factory (buildApp) is kept
// separate so tests drive the app in-process without a socket.
async function main(): Promise<void> {
  loadRootEnv()
  const env = loadEnv()
  const app = buildApp({ corsOrigin: env.CORS_ORIGIN })

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' })
  console.log(`API listening on http://localhost:${env.API_PORT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
