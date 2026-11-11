import type { SoundCloudClient, SoundCloudCredentials } from './soundcloud.js'
import type { SoundCloudCredentialsStore, StoredSoundCloudCredentials } from './soundcloud-credentials.js'

// The SoundCloud app the server reads SoundCloud through, whose credentials are entered on the admin pages (see "The
// SoundCloud app" in docs/design/server/radio.md): the radio reads its playlist through it, and sets resolve their tracks
// through it. They share the client for the credentials that were entered last, so that it only needs one token, since
// SoundCloud limits how many an app can get.

export const NO_CREDENTIALS = 'The credentials of the SoundCloud app have not been entered yet'

// Thrown when SoundCloud has to be asked something before the credentials have been entered.
export class NoSoundCloudCredentials extends Error {
  constructor() {
    super(NO_CREDENTIALS)
  }
}

// The credentials that were entered, and the client that uses them.
export type EnteredApp = { credentials: StoredSoundCloudCredentials; client: SoundCloudClient }

export type SoundCloudApp = {
  // Builds a client for SoundCloud that uses the credentials it's given, e.g. to check them.
  newClient: (credentials: SoundCloudCredentials) => SoundCloudClient
  // Saves the credentials, and uses `client`, which uses them, from now on.
  save(credentials: StoredSoundCloudCredentials, client: SoundCloudClient): Promise<void>
  // The credentials that were entered, with their client, or null until they are. They're loaded every time, so that
  // every server picks up a change. Credentials loaded before newer ones were saved, by a request that was already under
  // way, are ignored.
  current(): Promise<EnteredApp | null>
  // The id of the track a link to it on soundcloud.com leads to, or null when SoundCloud shows no track there. Throws a
  // NoSoundCloudCredentials until the credentials are entered, or SoundCloud's error.
  resolveTrack(link: string): Promise<string | null>
}

// Only keeps what it's given until it's used, so that it can be built without a database, e.g. by generate-openapi.ts.
export function soundCloudApp(newClient: SoundCloudApp['newClient'], credentials: SoundCloudCredentialsStore): SoundCloudApp {
  // The credentials that were entered last, with their client, which is replaced whenever they change.
  let last: EnteredApp | null = null

  function sameCredentials(a: SoundCloudCredentials, b: SoundCloudCredentials): boolean {
    return a.clientId === b.clientId && a.clientSecret === b.clientSecret
  }

  const app: SoundCloudApp = {
    newClient,

    async save(saved, client) {
      await credentials.save(saved)
      last = { credentials: saved, client }
    },

    async current() {
      const loaded = await credentials.load()
      if (!loaded) return null
      if (last && last.credentials.updatedAt > loaded.updatedAt) return last
      // The same credentials, entered again, keep their client, and its token.
      last = { credentials: loaded, client: last && sameCredentials(last.credentials, loaded) ? last.client : newClient(loaded) }
      return last
    },

    async resolveTrack(link) {
      const entered = await app.current()
      if (!entered) throw new NoSoundCloudCredentials()
      return entered.client.resolveTrack(link)
    },
  }
  return app
}
