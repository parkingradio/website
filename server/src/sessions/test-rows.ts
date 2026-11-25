import type { StoredSession, StoredSet } from './store.js'

// Sessions and sets, as the database gives them, for the tests that don't need one.

// An announced session of guest mixes, on November 14, 2026, from 21:00 to 23:00 in Québec, without sets, unless
// `fields` say otherwise.
export function storedSession(fields: Partial<StoredSession> = {}): StoredSession {
  return {
    id: 'session-1',
    createdAt: new Date('2026-10-01T12:00:00Z'),
    createdBy: 'admin@example.com',
    startAt: new Date('2026-11-15T02:00:00Z'),
    durationMinutes: 120,
    type: 'guest-mixes',
    name: '',
    takeoverId: null,
    applicationId: null,
    raEventId: null,
    description: '',
    flyerKey: null,
    flyerType: null,
    updatedBy: null,
    updatedAt: null,
    status: 'planned',
    statusUpdatedBy: null,
    statusUpdatedAt: null,
    announced: true,
    announcedUpdatedBy: null,
    announcedUpdatedAt: null,
    takeover: null,
    application: null,
    sets: [],
    ...fields,
  }
}

// A set of session-1, with its performers, by name.
export const storedSet = (names: string[], status: StoredSet['status'] = 'planned'): StoredSet => ({
  id: `set-${names.join('-')}`,
  createdAt: new Date('2026-10-01T12:00:00Z'),
  createdBy: 'admin@example.com',
  sessionId: 'session-1',
  position: 0,
  durationMinutes: 60,
  performanceTypes: ['dj'],
  otherPerformanceType: '',
  genres: [],
  soundcloudTrackId: null,
  soundcloudTrackUrl: null,
  youtubeVideoId: null,
  applicationId: null,
  updatedBy: null,
  updatedAt: null,
  status,
  statusUpdatedBy: null,
  statusUpdatedAt: null,
  performers: names.map((name) => ({ id: `artist-${name}`, name })),
  application: null,
})
