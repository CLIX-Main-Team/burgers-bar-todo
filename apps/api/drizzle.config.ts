import { defineConfig } from 'drizzle-kit'

// Versioned SQL migrations, committed and reviewed — never drizzle-kit push
// (ADR-0010). `drizzle-kit generate` writes SQL under ./drizzle from the schema.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://burgers:burgers@localhost:5432/burgers',
  },
  strict: true,
  verbose: true,
})
