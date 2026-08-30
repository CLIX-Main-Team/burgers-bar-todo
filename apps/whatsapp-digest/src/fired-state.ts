import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// The one fact the scheduler has to remember across a restart: the Jerusalem local date the digest
// last went out on (ADR-0026).
//
// It is persisted because the alternative is a double send. `restart: unless-stopped` brings the
// container back after a crash, a deploy, or a reboot, and an in-memory marker comes back empty — so
// a container that restarts at 09:30, after the 08:00 digest already went out, would send the same
// day a second time. Holding it on disk also lets the fire condition be the forgiving one ("this
// local date has not fired yet" rather than "the clock is exactly on the hour"), which is what makes
// a container that was down at 08:00 still send when it comes back at 09:30 instead of skipping the
// day in silence.
//
// One date string in one small file. There is no database in this workspace by design, and this is
// the only state the job keeps.
export interface FiredState {
  read(): string | null
  write(localDate: string): void
}

interface StoredState {
  lastFiredDate?: unknown
}

// A file-backed marker. Both halves degrade rather than throw: a state file that cannot be read is
// treated as "never fired" (the digest goes out, which is the recoverable direction), and one that
// cannot be written leaves the in-memory value correct for as long as this process lives. A daily
// summary must not be lost to a permissions problem on a marker file.
export function createFileFiredState(
  path: string,
  onWarning: (message: string) => void,
): FiredState {
  // Cached so the common case — a tick every minute, all day — does not read the disk each time.
  let cached: string | null = null
  let loaded = false

  return {
    read: () => {
      if (loaded) {
        return cached
      }
      loaded = true
      try {
        const parsed: StoredState = JSON.parse(readFileSync(path, 'utf-8'))
        cached = typeof parsed.lastFiredDate === 'string' ? parsed.lastFiredDate : null
      } catch {
        // Missing on the first ever run, which is the normal case and not worth a warning.
        cached = null
      }
      return cached
    },
    write: (localDate) => {
      cached = localDate
      loaded = true
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, JSON.stringify({ lastFiredDate: localDate }), 'utf-8')
      } catch (error) {
        const reason = error instanceof Error ? error.name : 'unknown error'
        onWarning(
          `could not persist the fired marker to ${path} (${reason}); a restart today may resend the digest`,
        )
      }
    },
  }
}

// The in-memory double, for tests and for a run that deliberately keeps no state.
export function createMemoryFiredState(initial: string | null = null): FiredState {
  let lastFired = initial
  return {
    read: () => lastFired,
    write: (localDate) => {
      lastFired = localDate
    },
  }
}
