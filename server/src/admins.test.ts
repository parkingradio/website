import { describe, expect, it, vi } from 'vitest'
import { createAdmin, inviteLink } from './admins.js'
import type { AdminsStore, InviteOutcome } from './admins.js'

function storeInviting(outcome: InviteOutcome) {
  return { invite: vi.fn<AdminsStore['invite']>(async () => outcome) }
}

describe('inviteLink', () => {
  it('leads to the page where admins choose their password', () => {
    expect(inviteLink('https://parking.radio', 'abc')).toBe('https://parking.radio/accept-invite?token=abc')
  })
})

describe('createAdmin', () => {
  it('invites active admins too', async () => {
    const store = storeInviting({ kind: 'invited', token: 'abc', admin: 'new' })
    await createAdmin(store, 'new@example.com', 'https://parking.radio')
    expect(store.invite).toHaveBeenCalledWith('new@example.com', { active: 'reinvite' })
  })

  it('says who the invite is for, and gives its link', async () => {
    const said = async (admin: 'new' | 'pending' | 'active') =>
      createAdmin(storeInviting({ kind: 'invited', token: 'abc', admin }), 'x@example.com', 'https://parking.radio')

    expect(await said('new')).toMatch(/^Created admin x@example\.com\./)
    expect(await said('pending')).toMatch(/^x@example\.com hadn't accepted their invite yet: earlier links no longer work\./)
    expect(await said('active')).toMatch(/^x@example\.com is already an admin: this link resets their password/)
    expect(await said('new')).toMatch(/\nhttps:\/\/parking\.radio\/accept-invite\?token=abc$/)
  })
})
