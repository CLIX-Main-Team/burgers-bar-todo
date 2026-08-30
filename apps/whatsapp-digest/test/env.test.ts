import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/env.js'

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
