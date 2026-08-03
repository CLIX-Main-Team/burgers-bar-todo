// The in-process task-change bus (#132, Slice A2, ADR-0015). This is the *unfiltered* interior
// seam: the write slices (B create/assign, C status, D reorder) announce "task X changed" here, and
// the SSE fan-out is the only subscriber — it re-reads each changed task through the scope predicate
// per connection before anything reaches a client. So there is deliberately no scope logic on this
// bus: it names the task that moved, nothing more, and the security boundary lives entirely in the
// fan-out that consumes it (the streaming analogue of ADR-0007's "no unscoped repository method").
//
// A change carries only the task id. The fan-out does not trust a snapshot riding on the event; it
// reads the task's current, scoped state from the store at delivery time, so what a subscriber
// receives is filtered by their scope *as it stands when the event fires* — a reassignment toward
// them is delivered, one away from them is withheld — and the payload can never diverge from what a
// plain scoped read would return.
export interface TaskChange {
  taskId: string
}

export type TaskChangeListener = (change: TaskChange) => void

// A synchronous fan-out register. publish() notifies every current subscriber; subscribe() returns
// the unsubscribe so a closing SSE connection detaches itself. A Set (not Node's EventEmitter)
// keeps it free of the max-listeners warning that a board with many open connections would trip,
// and makes "detach exactly this listener" a plain delete. A listener that throws is isolated so
// one wedged connection cannot stop delivery to the others.
export interface TaskBoardEvents {
  publish(change: TaskChange): void
  subscribe(listener: TaskChangeListener): () => void
}

export function createTaskBoardEvents(): TaskBoardEvents {
  const listeners = new Set<TaskChangeListener>()
  return {
    publish: (change) => {
      for (const listener of listeners) {
        try {
          listener(change)
        } catch {
          // A single subscriber's failure (a broken pipe on one connection) must not halt the
          // fan-out to the rest; the failed connection tears itself down on its own close event.
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
