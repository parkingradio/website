// `POST /api/admin/invite`: emails an invite to a new admin. Requires a session. Fails with 400 (missing
// email), 401 (no valid session), 409 (already an activated admin) or 500 (mail isn't configured).
export type InviteRequest = { email: string }
export type InviteResponse = { ok: true }
