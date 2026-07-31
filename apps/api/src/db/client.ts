import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

export type Db = ReturnType<typeof createDb>['db']

// A small server-side pool (not a connection per request), matching how prod
// talks to Supabase over the session pooler (engineering-design). Callers own the
// returned pool and close it on shutdown.
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString })
  const db = drizzle(pool, { schema })
  return { db, pool }
}
