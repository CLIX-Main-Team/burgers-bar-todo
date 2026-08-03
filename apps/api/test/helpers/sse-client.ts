import { type TaskBoardEvent, taskBoardEventSchema } from '@burgers/shared'

// A minimal, dependency-free SSE client for the board-channel test (#132). Node 22 exposes no
// EventSource global, so this reads the raw event stream over `fetch` and parses the frames itself
// — enough to prove the security-critical property the rule-5 test asserts: a real event stream,
// over a real socket, delivering (or withholding) `task.upserted` frames per subscriber. It is not
// a general SSE implementation; it understands exactly the frames the route emits (comment lines to
// keep-alive, and single-line `data:` payloads carrying a TaskBoardEvent).
export interface SseClient {
  // Resolves once the stream is open (the route writes a `: connected` comment the instant it has
  // subscribed to the bus, so a resolved `opened` means this connection will see later publishes).
  opened: Promise<void>
  // The board events received so far, in arrival order.
  received: TaskBoardEvent[]
  // Wait until an event matching the predicate has arrived, or reject after timeoutMs. Resolves
  // immediately if a matching event is already in `received`.
  waitFor(
    predicate: (event: TaskBoardEvent) => boolean,
    timeoutMs?: number,
  ): Promise<TaskBoardEvent>
  // Close the connection (aborts the fetch), so the server tears the subscription down.
  close(): void
}

export function openSse(url: string): SseClient {
  const controller = new AbortController()
  const received: TaskBoardEvent[] = []
  const waiters: {
    predicate: (e: TaskBoardEvent) => boolean
    resolve: (e: TaskBoardEvent) => void
  }[] = []

  let markOpened!: () => void
  const opened = new Promise<void>((resolve) => {
    markOpened = resolve
  })

  const deliver = (event: TaskBoardEvent): void => {
    received.push(event)
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i]
      if (waiter?.predicate(event)) {
        waiter.resolve(event)
        waiters.splice(i, 1)
      }
    }
  }

  // Drive the read loop in the background; a caller interacts only through the promises above.
  void (async () => {
    const response = await fetch(url, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    })
    if (!response.body) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    markOpened()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Frames are separated by a blank line. Parse every complete frame and keep the remainder.
        let sep: number = buffer.indexOf('\n\n')
        while (sep !== -1) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const dataLines = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
          if (dataLines.length > 0) {
            deliver(taskBoardEventSchema.parse(JSON.parse(dataLines.join('\n'))))
          }
          sep = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // An abort (close()) surfaces here as a read rejection; it is the intended shutdown, not a
      // failure. Any genuine parse error would have thrown synchronously in deliver above.
    }
  })()

  return {
    opened,
    received,
    waitFor: (predicate, timeoutMs = 2000) =>
      new Promise<TaskBoardEvent>((resolve, reject) => {
        const existing = received.find(predicate)
        if (existing) {
          resolve(existing)
          return
        }
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === wrapped)
          if (idx !== -1) waiters.splice(idx, 1)
          reject(new Error('SSE waitFor timed out'))
        }, timeoutMs)
        const wrapped = (event: TaskBoardEvent): void => {
          clearTimeout(timer)
          resolve(event)
        }
        waiters.push({ predicate, resolve: wrapped })
      }),
    close: () => controller.abort(),
  }
}
