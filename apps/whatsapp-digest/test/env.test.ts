import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/env.js'
import {
  LLM_TIMEOUT_MS,
  MERGE_TIMEOUT_MS,
  PROVIDER_PRESETS,
  resolveGroupLlmConfig,
  resolveLlmConfig,
} from '../src/llm-client.js'

const REQUIRED = {
  GREEN_API_URL: 'https://7107.api.greenapi.com',
  GREEN_API_ID_INSTANCE: '710722719110',
  GREEN_API_TOKEN_INSTANCE: 'token-value',
}

const load = (overrides: Record<string, string> = {}) => loadEnv({ ...REQUIRED, ...overrides })

describe('gateway credentials', () => {
  it('reports every missing key at once rather than one per restart', () => {
    expect(() => loadEnv({})).toThrow(/GREEN_API_URL[\s\S]*GREEN_API_ID_INSTANCE/)
  })

  it('rejects an apiUrl that is not a URL', () => {
    expect(() => load({ GREEN_API_URL: '7107.api.greenapi.com' })).toThrow(/GREEN_API_URL/)
  })
})

describe('WHATSAPP_DIGEST_RECIPIENT', () => {
  it('treats absent as blank, which is the expected state today', () => {
    expect(load().WHATSAPP_DIGEST_RECIPIENT).toBe('')
  })

  it('treats whitespace as blank rather than as a malformed number', () => {
    expect(load({ WHATSAPP_DIGEST_RECIPIENT: '   ' }).WHATSAPP_DIGEST_RECIPIENT).toBe('')
  })

  it('accepts a full international number', () => {
    expect(load({ WHATSAPP_DIGEST_RECIPIENT: '972501234567' }).WHATSAPP_DIGEST_RECIPIENT).toBe(
      '972501234567',
    )
  })

  it('rejects the Israeli national form, which would address a different number entirely', () => {
    // 0501234567 is how the number is written everywhere else and is the likeliest paste. WhatsApp
    // would not read it as 972501234567, so this has to fail at boot rather than misdeliver at 08:00.
    expect(() => load({ WHATSAPP_DIGEST_RECIPIENT: '0501234567' })).toThrow(
      /WHATSAPP_DIGEST_RECIPIENT/,
    )
  })

  it('rejects a leading plus', () => {
    expect(() => load({ WHATSAPP_DIGEST_RECIPIENT: '+972501234567' })).toThrow(
      /WHATSAPP_DIGEST_RECIPIENT/,
    )
  })

  it('accepts a group chatId, since the briefing is as often read by a group as by one person', () => {
    expect(
      load({ WHATSAPP_DIGEST_RECIPIENT: '120363411373854384@g.us' }).WHATSAPP_DIGEST_RECIPIENT,
    ).toBe('120363411373854384@g.us')
  })

  it('accepts the older creator-and-created group id long-lived groups still carry', () => {
    expect(
      load({ WHATSAPP_DIGEST_RECIPIENT: '972508951541-1434999874@g.us' }).WHATSAPP_DIGEST_RECIPIENT,
    ).toBe('972508951541-1434999874@g.us')
  })

  it('rejects a group id with its suffix left off, which would address a phone that does not exist', () => {
    expect(() => load({ WHATSAPP_DIGEST_RECIPIENT: '120363411373854384' })).toThrow(
      /WHATSAPP_DIGEST_RECIPIENT/,
    )
  })

  it('rejects separators', () => {
    expect(() => load({ WHATSAPP_DIGEST_RECIPIENT: '972-50-123-4567' })).toThrow(
      /WHATSAPP_DIGEST_RECIPIENT/,
    )
  })
})

describe('DIGEST_FIRE_HOUR', () => {
  it('defaults to the morning', () => {
    expect(load().DIGEST_FIRE_HOUR).toBe(8)
  })

  it('coerces the string an environment always delivers', () => {
    expect(load({ DIGEST_FIRE_HOUR: '17' }).DIGEST_FIRE_HOUR).toBe(17)
  })

  it('rejects an hour that is not on the clock', () => {
    expect(() => load({ DIGEST_FIRE_HOUR: '24' })).toThrow(/DIGEST_FIRE_HOUR/)
  })
})

// Pinned by a test because this default is not a tuning knob. The table it governs holds the
// client's real group conversations, so the number is how long a copy of them lives on our
// database, and raising it back by accident is a decision about their data that nobody made.
describe('WHATSAPP_MESSAGE_RETENTION_DAYS', () => {
  it('defaults to three days, not to a comfortable month', () => {
    expect(load().WHATSAPP_MESSAGE_RETENTION_DAYS).toBe(3)
  })

  it('coerces the string an environment always delivers', () => {
    expect(load({ WHATSAPP_MESSAGE_RETENTION_DAYS: '7' }).WHATSAPP_MESSAGE_RETENTION_DAYS).toBe(7)
  })

  it('rejects a retention of zero, which would delete the day being summarized', () => {
    expect(() => load({ WHATSAPP_MESSAGE_RETENTION_DAYS: '0' })).toThrow(
      /WHATSAPP_MESSAGE_RETENTION_DAYS/,
    )
  })
})

// The stage 1 model, and the one thing about it that is easy to get wrong. It must NOT inherit from
// ASSISTANT_MODEL: a deployment that pins the merge to the Pro model would otherwise drag all sixty
// per-branch calls onto it too, which is precisely the configuration that truncated on the busiest
// branch and lost it from the digest.
describe('WHATSAPP_SUMMARY_MODEL', () => {
  it('defaults stage 1 to the preset group model, not to the merge model', () => {
    const env = load({
      ASSISTANT_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'key',
      ASSISTANT_MODEL: 'google/gemini-3.1-pro-preview',
    })
    expect(resolveGroupLlmConfig(env).model).toBe(PROVIDER_PRESETS.openrouter.defaultGroupModel)
    expect(resolveLlmConfig(env).model).toBe('google/gemini-3.1-pro-preview')
  })

  it('is overridable on its own', () => {
    const env = load({
      ASSISTANT_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'key',
      WHATSAPP_SUMMARY_MODEL: 'google/gemini-2.5-flash',
    })
    expect(resolveGroupLlmConfig(env).model).toBe('google/gemini-2.5-flash')
  })
})

// The merge outlasts the branch calls, and by a lot. It is the only call whose output scales with
// the whole chain, and since it was told to be complete rather than brief it writes a line for
// nearly every branch. At 60 seconds it aborted in production AFTER all 58 branches were summarized
// and paid for, which is the worst place in the run to fail.
describe('the merge timeout', () => {
  it('is far longer than a branch call gets', () => {
    expect(MERGE_TIMEOUT_MS).toBeGreaterThanOrEqual(4 * LLM_TIMEOUT_MS)
  })

  it('reaches the merge config without touching the branch config', () => {
    const env = load({ ASSISTANT_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'key' })
    expect(resolveLlmConfig(env, MERGE_TIMEOUT_MS).timeoutMs).toBe(MERGE_TIMEOUT_MS)
    // Branches stay quick: one of them hanging should not hold the queue for five minutes, and the
    // ladder gives a slow branch other ways to succeed.
    expect(resolveGroupLlmConfig(env).timeoutMs).toBe(LLM_TIMEOUT_MS)
  })
})

// The derived rows age out too, on a longer clock than the messages. Pinned because both numbers are
// statements about how long a copy of the client's operations lives on our database, and the
// relationship between them is the part that is easy to break: summaries outliving messages is the
// whole point, and a purge that ran the other way round would delete the briefings while keeping the
// chat they were made from.
describe('WHATSAPP_SUMMARY_RETENTION_DAYS', () => {
  it('defaults to ten days', () => {
    expect(load().WHATSAPP_SUMMARY_RETENTION_DAYS).toBe(10)
  })

  it('outlives the raw messages, which is the reason it is a separate setting', () => {
    const env = load()
    expect(env.WHATSAPP_SUMMARY_RETENTION_DAYS).toBeGreaterThan(env.WHATSAPP_MESSAGE_RETENTION_DAYS)
  })

  it('coerces the string an environment always delivers', () => {
    expect(load({ WHATSAPP_SUMMARY_RETENTION_DAYS: '30' }).WHATSAPP_SUMMARY_RETENTION_DAYS).toBe(30)
  })
})
