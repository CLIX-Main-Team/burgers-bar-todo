import { describe, expect, it } from 'vitest'
import { connectSrcFor } from './csp.js'

describe('connectSrcFor', () => {
  // The case this function was written for. The mobile build's base URL carries a path
  // because the VPS serves the SPA and the API from one origin, and a CSP source with a
  // path is matched exactly — `https://host/api` would refuse `https://host/api/auth/sign-in`
  // and take every request in the app with it.
  it('drops the path from an API base that has one', () => {
    expect(connectSrcFor('https://burgers.srv1928986.hstgr.cloud/api')).toBe(
      'https://burgers.srv1928986.hstgr.cloud',
    )
  })

  it('keeps the port, which is part of the origin', () => {
    expect(connectSrcFor('https://api.example.com:8443/api')).toBe('https://api.example.com:8443')
  })

  it('passes a bare origin through unchanged', () => {
    expect(connectSrcFor('https://burgers-bar-api.onrender.com')).toBe(
      'https://burgers-bar-api.onrender.com',
    )
  })

  // The browser SPA is built with VITE_API_BASE_URL=/api and served same-origin, which
  // 'self' already covers. A bare path is not a valid source expression, so emitting one
  // would add a parse error to the policy and nothing else.
  it('emits nothing for a same-origin base', () => {
    expect(connectSrcFor('/api')).toBe('')
    expect(connectSrcFor('')).toBe('')
  })
})
