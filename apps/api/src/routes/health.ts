import { healthResponseSchema } from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

// A trivial boot/health route. It proves the walking skeleton — the app builds,
// routes register, and the shared zod contract serializes a response — without
// carrying any auth behaviour yet.
export function registerHealthRoute(app: FastifyInstance): void {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/health',
      { schema: { response: { 200: healthResponseSchema } } },
      async () => ({ status: 'ok', service: 'api' }) as const,
    )
}
