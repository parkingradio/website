import type { ApplicationFields } from './fields.js'
import { applicationsStore } from './store.js'
import { artistsStore } from '../artists/store.js'
import type { StoredPhoto } from '../artists/store.js'
import type { ApplicantProfile, Profile } from '../artists/profile.js'
import { collectivesStore } from '../collectives/store.js'
import type { CollectiveProfile } from '../collectives/profile.js'
import type { db as Database } from '../db/connection.js'

// Stores the applications that new artists and collectives send themselves, from `POST /api/applications`. On the admin
// pages, an application is always for an artist or a collective who already exists. Here, they're created too. Those
// who already exist will apply again from a different page, which isn't designed yet.

export type ApplyStore = {
  // Creates the artist, with this profile and photo, and their application, both with a null `createdBy`. Returns their
  // ids. If an artist with the same email already exists (ignoring case), throws an EmailTaken and creates nothing.
  apply(
    artist: ApplicantProfile & StoredPhoto,
    application: ApplicationFields,
  ): Promise<{ artistId: string; applicationId: string }>
  // Creates the collective, with this profile and photo, its `members`, as new artists, in order, and its application,
  // all with a null `createdBy`. Returns the ids of the collective and its application. If a collective with the same
  // email already exists (ignoring case), throws an EmailTaken and creates nothing.
  applyAsCollective(
    collective: Omit<CollectiveProfile, 'members'> & StoredPhoto,
    members: (Profile & StoredPhoto)[],
    application: ApplicationFields,
  ): Promise<{ collectiveId: string; applicationId: string }>
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

    applyAsCollective(collective, members, application) {
      // Likewise, and the EmailTaken that creating the collective throws rolls its artists back too.
      return db.transaction(async (tx) => {
        const ids: { id: string }[] = []
        for (const member of members) ids.push({ id: (await artistsStore(tx).create({ ...member, createdBy: null })).id })
        const added = await collectivesStore(tx).create({ ...collective, members: ids, createdBy: null })
        const created = await applicationsStore(tx).create({ ...application, collectiveId: added.id, createdBy: null })
        return { collectiveId: added.id, applicationId: created.id }
      })
    },
  }
}
