import * as matchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterEach, expect } from 'vitest'

// jest-dom's DOM matchers (toHaveAttribute, toHaveClass, …) extended onto Vitest's expect.
// The explicit extend is the canonical wiring and keeps this independent of jest-dom's
// framework auto-detection.
expect.extend(matchers)

// Auto-cleanup only registers when Vitest globals are on, and this lane keeps them off
// (tests import describe/it/expect explicitly), so unmount the rendered tree after each test
// by hand to keep the jsdom document isolated between cases.
afterEach(cleanup)
