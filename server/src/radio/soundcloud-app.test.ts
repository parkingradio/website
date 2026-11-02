import { describe, expect, it, vi } from 'vitest'
import type { SoundCloudClient } from './soundcloud.js'
import { NoSoundCloudCredentials, soundCloudApp } from './soundcloud-app.js'
import type { StoredSoundCloudCredentials } from './soundcloud-credentials.js'

// The radio's routes cover how the app's client follows the credentials (see radio/routes.test.ts).

const ENTERED: StoredSoundCloudCredentials = { clientId: 'id', clientSecret: 'secret', updatedBy: 'admin@example.com', updatedAt: new Date() }

describe('soundCloudApp', () => {
  it('resolves tracks through the client for the credentials that were entered, once they are', async () => {
    const resolveTrack = vi.fn<SoundCloudClient['resolveTrack']>(async () => '42')
    const newClient = vi.fn(() => ({ resolveTrack }) as unknown as SoundCloudClient)
    let entered: StoredSoundCloudCredentials | null = null
    const app = soundCloudApp(newClient, { load: async () => entered, save: async () => {} })

    await expect(app.resolveTrack('https://soundcloud.com/a/b')).rejects.toBeInstanceOf(NoSoundCloudCredentials)
    expect(newClient).not.toHaveBeenCalled()

    entered = ENTERED
    expect(await app.resolveTrack('https://soundcloud.com/a/b')).toBe('42')
    expect(await app.resolveTrack('https://soundcloud.com/a/c')).toBe('42')
    expect(resolveTrack).toHaveBeenLastCalledWith('https://soundcloud.com/a/c')
    // The same client, and its token, every time.
    expect(newClient).toHaveBeenCalledTimes(1)
  })
})
