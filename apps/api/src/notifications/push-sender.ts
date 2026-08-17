// The push transport port (#59 delivery side), the notification twin of auth/mailer.ts: one
// behaviour — put a built message on a set of devices — behind a transport-agnostic interface, so
// callers construct a message and never name Firebase. The single real implementation lives in
// fcm-push-sender.ts; the capturing fake below is the test double, and nothing else about push is
// mocked. Message construction (the wording, the language it is written in) belongs to the caller,
// not here — the port only carries a built message, exactly as the mailer does.
//
// Why a port at all, when there is one vendor: Apple and Google are the only two services that can
// wake a phone, so the transport is not a choice we get to make. What the port buys is the seam
// tests drive and the boot-time swap that lets the whole feature ship dormant — with no Firebase
// credentials configured the server wires the no-op sender below and every other line of this
// feature still runs.

export interface PushMessage {
  // The devices to reach, as registration tokens. Every token in one message shares a title and
  // body, so the caller groups by language before building the message.
  tokens: readonly string[]
  title: string
  body: string
  // Structured payload the app reads on tap — a task id, so opening the notification opens the
  // task. Values are strings because that is all the push transports carry.
  data?: Record<string, string>
}

export interface PushDelivery {
  // Tokens the transport refused as no longer registered: the app was uninstalled, or the device
  // rotated its token and the old one is dead. The caller deletes these, which is the only reason
  // the port reports them — without it the device table fills with phones that will never ring.
  staleTokens: readonly string[]
}

export interface PushSender {
  // Never rejects for a delivery failure. A phone that cannot be reached is not a reason for the
  // write that triggered it to fail, so a transport error is logged by the implementation and
  // swallowed here; only a programming error escapes.
  send(message: PushMessage): Promise<PushDelivery>
}

// A capturing fake — the test double, mirroring createCapturingMailer. It records every message it
// was asked to send so a test can assert exactly who would have been rung and in which language,
// without a network. It lives in src/ rather than test/ so the notifier and its tests share one
// definition, the same reason the capturing mailer and the mutable clock do.
export interface CapturingPushSender extends PushSender {
  readonly sent: readonly PushMessage[]
  clear(): void
}

export function createCapturingPushSender(): CapturingPushSender {
  const messages: PushMessage[] = []
  return {
    send: async (message) => {
      messages.push(message)
      return { staleTokens: [] }
    },
    get sent() {
      return messages
    },
    clear: () => {
      messages.length = 0
    },
  }
}

// The sender the server wires when no Firebase credentials are configured — which is every
// deployment until the client's Firebase project exists. It accepts and drops, so the device
// registration, the assignee diff, and the message construction all run and are exercised in
// production long before anything can actually ring. Turning push on is then a credentials change,
// not a code change.
export function createNoopPushSender(): PushSender {
  return {
    send: async () => ({ staleTokens: [] }),
  }
}
