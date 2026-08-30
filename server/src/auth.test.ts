import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './auth.js'

describe('passwords', () => {
  it('does not just return the password unchanged', async () => {
    const hash = await hashPassword('correct-password')
    expect(hash).not.toBe('correct-password')
  })

  it('verifies a matching password against its hash', async () => {
    const hash = await hashPassword('correct-password')
    expect(await verifyPassword('correct-password', hash)).toBe(true)
  })

  it('rejects a non-matching password', async () => {
    const hash = await hashPassword('correct-password')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })
})
