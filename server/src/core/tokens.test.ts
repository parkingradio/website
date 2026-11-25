import { describe, expect, it } from 'vitest'
import { TOKEN_FORMAT, generateToken, hashToken, randomToken } from './tokens.js'

describe('tokens', () => {
  it('produces a hash that hashToken can reproduce from the raw token', () => {
    const { token, tokenHash } = generateToken()
    expect(hashToken(token)).toBe(tokenHash)
  })

  it('generates different tokens on each call', () => {
    expect(generateToken().token).not.toBe(generateToken().token)
    expect(randomToken()).not.toBe(randomToken())
  })

  it('generates tokens of the format they are checked against', () => {
    expect(generateToken().token).toMatch(TOKEN_FORMAT)
    expect(randomToken()).toMatch(TOKEN_FORMAT)
  })
})
