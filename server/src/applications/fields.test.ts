import { describe, expect, it } from 'vitest'
import { applicationStatus } from './fields.js'

// An application's status, worked out from what admins decided and from its sets' or sessions' statuses (see "Status" in
// docs/design/server/applications.md).

describe('applicationStatus', () => {
  it('is rejected when the application is, whatever its sets and sessions', () => {
    expect(applicationStatus('rejected', [])).toBe('rejected')
    expect(applicationStatus('rejected', ['cancelled', 'cancelled'])).toBe('rejected')
  })

  it('is planned when one of its sets or sessions is, before one that is done, whatever was decided', () => {
    for (const decision of ['new', 'accepted'] as const) {
      expect(applicationStatus(decision, ['planned'])).toBe('planned')
      expect(applicationStatus(decision, ['done', 'cancelled', 'planned'])).toBe('planned')
    }
  })

  it('is done when one of its sets or sessions is, and none is planned, whatever was decided', () => {
    for (const decision of ['new', 'accepted'] as const) {
      expect(applicationStatus(decision, ['done'])).toBe('done')
      expect(applicationStatus(decision, ['cancelled', 'done'])).toBe('done')
    }
  })

  it('is accepted when it was accepted, or all of its sets and sessions are cancelled', () => {
    expect(applicationStatus('accepted', [])).toBe('accepted')
    expect(applicationStatus('accepted', ['cancelled'])).toBe('accepted')
    expect(applicationStatus('new', ['cancelled', 'cancelled'])).toBe('accepted')
  })

  it('is new otherwise', () => {
    expect(applicationStatus('new', [])).toBe('new')
  })
})
