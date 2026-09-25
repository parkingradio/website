// `POST /api/auth/login`: sets the session cookie. Fails with 400 (missing fields), 401 (wrong email or
// password) or 429 (too many attempts).
export type LoginRequest = { email: string; password: string }
export type LoginResponse = { ok: true; email: string }

// `POST /api/auth/logout`: clears the session cookie. Takes no body.
export type LogoutResponse = { ok: true }

// `POST /api/auth/accept-invite`: sets the invited admin's password. Fails with 400 (missing fields,
// password too short, or invalid or expired invite).
export type AcceptInviteRequest = { token: string; password: string }
export type AcceptInviteResponse = { ok: true }

// `GET /api/admin/me`: the logged-in admin. Fails with 401 without a valid session.
export type MeResponse = { ok: true; email: string }
