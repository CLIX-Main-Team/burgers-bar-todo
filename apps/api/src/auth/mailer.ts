// The mailer port (ADR-0008, auth plan mailer seam): one behaviour — send a message to
// a recipient — behind a transport-agnostic interface, so callers construct a message
// and never touch SMTP. The single SMTP implementation lives in smtp-mailer.ts (mailpit
// locally, Gmail in prod, same code path); the capturing fake below is the test double,
// and nothing else about mail is mocked. Message construction (subjects, the one-time
// link body) belongs to the callers, not here — the port only carries a built message.

// The smallest message the invite and reset flows both need. `text` carries the
// one-time link; a richer html body can be added later without touching callers.
export interface MailMessage {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  send(message: MailMessage): Promise<void>
}

// A capturing fake — the test double the plan names. It records every message it is
// asked to send so a test can assert exactly one mail went out and drive the one-time
// link inside it back through the API (auth plan, testing approach). It is here in src/
// rather than under test/ so the invite service and its tests share one definition, the
// same reason the mutable clock lives beside the real one.
export interface CapturingMailer extends Mailer {
  readonly sent: readonly MailMessage[]
  clear(): void
}

export function createCapturingMailer(): CapturingMailer {
  const messages: MailMessage[] = []
  return {
    send: async (message) => {
      messages.push(message)
    },
    get sent() {
      return messages
    },
    clear: () => {
      messages.length = 0
    },
  }
}
