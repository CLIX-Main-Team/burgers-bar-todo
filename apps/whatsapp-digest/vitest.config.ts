import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Collection is pinned to the sibling test/ directory for one reason: the scriptable fakes live
    // in src beside the ports they double (as the API's do), and the default glob would sweep them
    // up looking for suites. Nothing else is overridden — this suite is in-memory fakes with no
    // network and no database, so it needs none of the API's Testcontainers timeouts or its
    // single-fork pool.
    include: ['test/**/*.test.ts'],
  },
})
