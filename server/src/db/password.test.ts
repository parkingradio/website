import { beforeEach, describe, expect, it, vi } from 'vitest'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = send
  },
  GetSecretValueCommand: class {
    constructor(input: unknown) {
      Object.assign(this as object, input)
    }
  },
}))

import { secretsManagerPassword } from './password.js'

describe('secretsManagerPassword', () => {
  beforeEach(() => {
    send.mockReset()
  })

  it('reads the password from the secret', async () => {
    send.mockResolvedValue({ SecretString: JSON.stringify({ username: 'parking_radio', password: 'p@ss' }) })

    expect(await secretsManagerPassword('my-secret', 'us-east-1')()).toBe('p@ss')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ SecretId: 'my-secret' }))
  })

  it('fetches the secret every time, so a rotated password is picked up', async () => {
    send
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ password: 'old' }) })
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ password: 'new' }) })
    const password = secretsManagerPassword('my-secret', 'us-east-1')

    expect(await password()).toBe('old')
    expect(await password()).toBe('new')
  })

  it('fails when the secret has no password', async () => {
    send.mockResolvedValue({ SecretString: JSON.stringify({ username: 'parking_radio' }) })

    await expect(secretsManagerPassword('my-secret', 'us-east-1')()).rejects.toThrow('does not contain a password')
  })
})
