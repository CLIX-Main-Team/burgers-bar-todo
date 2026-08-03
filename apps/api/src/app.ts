import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { type AuthRouteDeps, registerAuthRoutes } from './routes/auth.js'
import { registerHealthRoute } from './routes/health.js'
import { type ThreadRouteDeps, registerThreadRoutes } from './routes/threads.js'

export interface BuildAppOptions {
  // The origin the SPA is served from; drives CORS so the cross-origin bearer
  // path is exercised in dev (ADR-0010). Tests omit it (in-process app.inject).
  corsOrigin?: string
  // The auth services, wired against a db and clock outside the factory (see
  // auth/wire.ts). Present for the running server and the integration harness;
  // omitted only where a route-free boot is enough (nothing needs it today).
  auth?: AuthRouteDeps
  // The assistant thread service (#90), wired at the assistant composition point (see
  // assistant/wire.ts). Present for the running server and the integration harness.
  threads?: ThreadRouteDeps
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

  return app
}
