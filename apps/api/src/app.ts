import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { registerHealthRoute } from './routes/health.js'

export interface BuildAppOptions {
  // The origin the SPA is served from; drives CORS so the cross-origin bearer
  // path is exercised in dev (ADR-0010). Tests omit it (in-process app.inject).
  corsOrigin?: string
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

  return app
}
