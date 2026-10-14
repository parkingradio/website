import { describe, expect, it, vi } from 'vitest'
import { adminStatus, createAdmin, inviteLink } from './admins.js'
import type { AdminsStore, InviteOutcome } from './admins.js'

function storeInviting(outcome: InviteOutcome) {
  return { invite: vi.fn<AdminsStore['invite']>(async () => outcome) }
}

describe('adminStatus', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  const later = new Date('2026-10-15T12:00:00Z')
  const earlier = new Date('2026-10-13T12:00:00Z')

  it('is active once the admin has chosen their password, whatever their invites', () => {
    expect(adminStatus({ active: true, inviteExpiresAt: null }, now)).toBe('active')
    expect(adminStatus({ active: true, inviteExpiresAt: later }, now)).toBe('active')
  })

  it('is invited while their invite lasts, and expired after, or once it was cleaned up', () => {
    expect(adminStatus({ active: false, inviteExpiresAt: later }, now)).toBe('invited')
    expect(adminStatus({ active: false, inviteExpiresAt: earlier }, now)).toBe('expired')
    expect(adminStatus({ active: false, inviteExpiresAt: now }, now)).toBe('expired')
    expect(adminStatus({ active: false, inviteExpiresAt: null }, now)).toBe('expired')
  })
})

describe('inviteLink', () => {
  it('leads to the page where admins choose their password', () => {
    expect(inviteLink('https://parking.radio', 'abc')).toBe('https://parking.radio/accept-invite?token=abc')
  })
})

describe('createAdmin', () => {
  it('invites active admins too, as invited by nobody', async () => {
    const store = storeInviting({ kind: 'invited', token: 'abc', admin: 'new' })
    await createAdmin(store, 'new@example.com', 'https://parking.radio')
    expect(store.invite).toHaveBeenCalledWith('new@example.com', { active: 'reinvite', invitedBy: null })
  })

  it('says who the invite is for, and gives its link', async () => {
    const said = async (admin: 'new' | 'pending' | 'active') =>
      createAdmin(storeInviting({ kind: 'invited', token: 'abc', admin }), 'x@example.com', 'https://parking.radio')

    expect(await said('new')).toMatch(/^Created admin x@example\.com\./)
    expect(await said('pending')).toMatch(/^x@example\.com hadn't accepted their invite yet: earlier links no longer work\./)
    expect(await said('active')).toMatch(/^x@example\.com is already an admin: this link resets their password.*logs them out everywhere\./)
    expect(await said('new')).toMatch(/\nhttps:\/\/parking\.radio\/accept-invite\?token=abc$/)
  })
})
