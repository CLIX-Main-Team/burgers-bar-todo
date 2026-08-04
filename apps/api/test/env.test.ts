import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/env.js'

// Boot-time configuration validation for the Drive knowledge-corpus credentials (ADR-0021, story
// 11): a misconfigured deploy must fail loudly at loadEnv rather than silently run a permanently
// empty knowledge base. loadEnv is pure over its source object, so these run with no DB or network.
// The base64/JSON decode is the one piece of real logic here; every other field has a default or is
// exercised elsewhere (llm-config.test.ts).

const serviceAccount = {
  client_email: 'sync@burgers.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n',
}
const validKey = Buffer.from(JSON.stringify(serviceAccount)).toString('base64')

// The minimal source that parses: the three fields with no default, everything else defaulted.
const base = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/burgers',
  GOOGLE_SERVICE_ACCOUNT_JSON: validKey,
  DRIVE_FOLDER_ID: 'folder-abc123',
}

describe('loadEnv: Drive knowledge-corpus credentials (ADR-0021)', () => {
  it('decodes a base64 service-account key into { clientEmail, privateKey } and passes the folder id through', () => {
    const env = loadEnv(base)
    expect(env.GOOGLE_SERVICE_ACCOUNT_JSON).toEqual({
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
    })
    expect(env.DRIVE_FOLDER_ID).toBe('folder-abc123')
  })

  it('fails loudly when the service-account key is absent', () => {
    const { GOOGLE_SERVICE_ACCOUNT_JSON: _omitted, ...withoutKey } = base
    expect(() => loadEnv(withoutKey)).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/)
  })

  it('fails loudly when the folder id is absent', () => {
    const { DRIVE_FOLDER_ID: _omitted, ...withoutFolder } = base
    expect(() => loadEnv(withoutFolder)).toThrow(/DRIVE_FOLDER_ID/)
  })

  it('rejects a service-account key that is not base64-encoded JSON', () => {
    expect(() =>
      loadEnv({ ...base, GOOGLE_SERVICE_ACCOUNT_JSON: 'not-valid-base64-json!!!' }),
    ).toThrow(/base64-encoded JSON/)
  })

  it('rejects a decoded key missing client_email / private_key', () => {
    const incomplete = Buffer.from(JSON.stringify({ client_email: 'only@half.com' })).toString(
      'base64',
    )
    expect(() => loadEnv({ ...base, GOOGLE_SERVICE_ACCOUNT_JSON: incomplete })).toThrow(
      /client_email and private_key/,
    )
  })
})
