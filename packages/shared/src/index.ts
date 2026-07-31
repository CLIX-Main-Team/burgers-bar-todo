import { z } from 'zod'

// The SPA-to-API contract: zod schemas shared by both sides (engineering-design),
// wired into Fastify via fastify-type-provider-zod. This foundation slice ships
// only the health/boot contract; the auth operation schemas land with their slices.

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
