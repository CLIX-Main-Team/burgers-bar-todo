import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { type AssistantRouteDeps, registerAssistantRoutes } from './routes/assistant.js'
import { type AuthRouteDeps, registerAuthRoutes } from './routes/auth.js'
import { type DeviceRouteDeps, registerDeviceRoutes } from './routes/devices.js'
import { registerHealthRoute } from './routes/health.js'
import { type LocationRouteDeps, registerLocationRoutes } from './routes/locations.js'
import { type TaskBoardRouteDeps, registerTaskBoardRoutes } from './routes/task-board.js'
import { type ThreadRouteDeps, registerThreadRoutes } from './routes/threads.js'

export interface BuildAppOptions {
  // The origins the SPA is served from; drives CORS so the cross-origin bearer
  // path is exercised in dev (ADR-0010). An array since the Capacitor wrapper apps
  // call from their own fixed WebView origins alongside the browser SPA origin.
  // Tests omit it (in-process app.inject).
  corsOrigin?: string | string[]
  // The auth services, wired against a db and clock outside the factory (see
  // auth/wire.ts). Present for the running server and the integration harness;
  // omitted only where a route-free boot is enough (nothing needs it today).
  auth?: AuthRouteDeps
  // The assistant thread service (#90), wired at the assistant composition point (see
  // assistant/wire.ts). Present for the running server and the integration harness.
  threads?: ThreadRouteDeps
  // The task-board read surface (#131, Slice A), wired at the task-board composition point (see
  // task-board/wire.ts). Present for the running server and the integration harness; later board
  // slices grow the deps bag with the SSE channel and the write services.
  taskBoard?: TaskBoardRouteDeps
  // The admin locations API (#164, Slice L1), wired against the location repository (see
  // locations/repository.ts). Present for the running server and the integration harness; the UI
  // consumers (L2 screen, L3 invite/task pickers) read the endpoints it registers.
  locations?: LocationRouteDeps
  // The assistant sync surface — in this slice, the manual resync endpoint (#89). Wired
  // against the assistant components (see assistant/wire.ts) and omitted where the
  // assistant Drive sync is not provisioned, so the running server registers it only once
  // the real Drive adapter is in place (ADR-0014); the integration harness always wires it.
  assistant?: AssistantRouteDeps
  // The push-device registration surface (#59), wired against the device repository (see
  // notifications/wire.ts). Present for the running server and the integration harness; it is
  // registered regardless of whether a push transport is configured, since a device registering
  // itself is what makes turning push on later a credentials change rather than a code change.
  devices?: DeviceRouteDeps
}

// The Fastify application factory. Building the app is separate from listening,
// so the integration suite can drive it in-process via app.inject() with no
// network, and later feature slices register their routes here.
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()

  // Wire zod as the validation and serialization engine (fastify-type-provider-zod),
  // so route schemas from packages/shared validate requests and shape responses.
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  if (options.corsOrigin) {
    app.register(cors, { origin: options.corsOrigin })
  }

  registerHealthRoute(app)
  if (options.auth) {
    registerAuthRoutes(app, options.auth)
  }
  if (options.threads) {
    registerThreadRoutes(app, options.threads)
  }
  if (options.taskBoard) {
    registerTaskBoardRoutes(app, options.taskBoard)
  }
  if (options.locations) {
    registerLocationRoutes(app, options.locations)
  }
  if (options.assistant) {
    registerAssistantRoutes(app, options.assistant)
  }
  if (options.devices) {
    registerDeviceRoutes(app, options.devices)
  }

  return app
}
