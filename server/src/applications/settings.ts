import type { Queryable } from '../db/connection.js'
import { applicationsSettings } from '../db/schema.js'

// Who the applications artists send are emailed to, as chosen on the admin pages.
export type ApplicationsSettings = {
  recipients: string[]
  // The email of the admin who last changed them, and when.
  updatedBy: string
  updatedAt: Date
}

export type ApplicationsSettingsStore = {
  // Null until the recipients have been chosen.
  load(): Promise<ApplicationsSettings | null>
  save(settings: ApplicationsSettings): Promise<void>
}

export function applicationsSettingsStore(db: Queryable): ApplicationsSettingsStore {
  return {
    async load() {
      const [row] = await db.select().from(applicationsSettings)
      return row ? { recipients: row.recipients, updatedBy: row.updatedBy, updatedAt: row.updatedAt } : null
    },

    async save(settings) {
      await db.insert(applicationsSettings).values(settings).onConflictDoUpdate({ target: applicationsSettings.id, set: settings })
    },
  }
}
