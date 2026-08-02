import type { Clock } from './clock.js'

// A fixed-window rate limiter for the reset-request endpoint (#34, story 30). It counts
// requests per key over a window and reports whether a request is within the limit. State
// is in-process — sufficient for a single-node small deployment (right-sizing); a
// multi-node deployment would move this to a shared store, but that is not in scope now.
// Time comes only from the injected clock, so a test drives the window deterministically
// rather than sleeping.

export interface RateLimiter {
  // Record a hit for `key` and report whether it is within the limit. Every call counts —
  // a hit that trips the limit still counts against the window — so throttling is applied
  // uniformly. Returns true when allowed, false when the key is over its limit.
  hit(key: string): boolean
  // Drop all window state. The running server never calls this; the test harness does,
  // between cases, so one test's requests do not carry into the next.
  clear(): void
}

interface Window {
  // The start of the current fixed window, in epoch ms from the injected clock.
  startedAt: number
  count: number
}

export interface RateLimiterConfig {
  maxHits: number
  windowMs: number
}

export function createRateLimiter(clock: Clock, config: RateLimiterConfig): RateLimiter {
  const windows = new Map<string, Window>()

  return {
    hit: (key) => {
      const now = clock.now().getTime()
      const existing = windows.get(key)
      // First hit for this key, or the prior window has fully elapsed: open a fresh window.
      if (!existing || now - existing.startedAt >= config.windowMs) {
        windows.set(key, { startedAt: now, count: 1 })
        return config.maxHits >= 1
      }
      existing.count += 1
      return existing.count <= config.maxHits
    },
    clear: () => {
      windows.clear()
    },
  }
}

// The reset endpoint's combined limiter: one request is checked against both a per-email
// window and a per-IP window (story 30). A request counts against both regardless of
// outcome, so a throttled request still consumes budget and still returns the generic
// confirmation. Email is lowercased so capitalisation cannot dodge the per-email limit.
export interface ResetRateLimiter {
  allow(email: string, ip: string): boolean
  clear(): void
}

export interface ResetRateLimiterConfig {
  perEmail: number
  perIp: number
  windowMs: number
}

export function createResetRateLimiter(
  clock: Clock,
  config: ResetRateLimiterConfig,
): ResetRateLimiter {
  const byEmail = createRateLimiter(clock, { maxHits: config.perEmail, windowMs: config.windowMs })
  const byIp = createRateLimiter(clock, { maxHits: config.perIp, windowMs: config.windowMs })

  return {
    allow: (email, ip) => {
      // Both are always recorded — no short-circuit — so one window tripping never spares
      // the other from counting this request.
      const emailOk = byEmail.hit(email.toLowerCase())
      const ipOk = byIp.hit(ip)
      return emailOk && ipOk
    },
    clear: () => {
      byEmail.clear()
      byIp.clear()
    },
  }
}
