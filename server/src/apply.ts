import type { ApplicationFields } from './application-fields.js'
import { applicationsStore } from './applications.js'
import { artistsStore } from './artists.js'
import type { StoredPhoto } from './artists.js'
import type { Profile } from './artist-profile.js'
import type { db as Database } from './db.js'

// Stores the applications that new artists send themselves, from `POST /api/applications`. On the admin pages, an
// application is always for an artist who already exists. Here, the artist is created too. Artists who already exist
// will apply again from a different page, which isn't designed yet.

export type ApplyStore = {
  // Creates the artist, with this profile and photo, and their application, both with a null `createdBy`. Returns their
  // ids. If an artist with the same email already exists (ignoring case), throws an EmailTaken and creates nothing.
  apply(
    artist: Profile & StoredPhoto,
    application: ApplicationFields,
  ): Promise<{ artistId: string; applicationId: string }>
}

export function applyStore(db: typeof Database): ApplyStore {
  return {
    apply(artist, application) {
      // The same stores as the admin pages use, in a single transaction, so that the artist is only created along with
      // their application.
      return db.transaction(async (tx) => {
        const added = await artistsStore(tx).create({ ...artist, createdBy: null })
        const created = await applicationsStore(tx).create({ ...application, artistId: added.id, createdBy: null })
        return { artistId: added.id, applicationId: created.id }
      })
    },
  }
}
