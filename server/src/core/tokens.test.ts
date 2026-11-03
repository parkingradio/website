import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from './tokens.js'

describe('tokens', () => {
  it('produces a hash that hashToken can reproduce from the raw token', () => {
    const { token, tokenHash } = generateToken()
    expect(hashToken(token)).toBe(tokenHash)
  })

  it('generates different tokens on each call', () => {
    expect(generateToken().token).not.toBe(generateToken().token)
  })
})
