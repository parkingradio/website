// All the endpoints below require an admin session, and fail with 401 without one.

// `POST /api/admin/invite`: emails an invite to a new admin, or a new invite to an admin who hasn't accepted theirs. Fails
// with 400 (missing email), 409 (already an activated admin) or 500 (mail isn't configured).
export type InviteRequest = { email: string }
export type InviteResponse = { ok: true }

// 'active' once the admin has chosen their password. Until then, 'invited' while their invite lasts, and 'expired' after.
export type AdminStatus = 'active' | 'invited' | 'expired'

export type Admin = {
  id: string
  email: string
  status: AdminStatus
  // When their invite expires (ISO 8601), while they're 'invited'. Null otherwise.
  inviteExpiresAt: string | null
  // The email of the admin who invited them, or null when they were created with the create-admin command, or before
  // that was known.
  invitedBy: string | null
  // When they were invited (ISO 8601).
  createdAt: string
  // Whether this is the admin who asked.
  you: boolean
}

// `GET /api/admin/admins`: every admin, by email.
export type AdminsResponse = { ok: true; admins: Admin[] }

// `DELETE /api/admin/admins/:id`: revokes an admin, who can't log in or use the sessions they have anymore, or cancels
// their invite if they haven't accepted it yet. Fails with 404 if there's no such admin, or 409 for the admin who asks.
export type DeleteAdminResponse = { ok: true }
