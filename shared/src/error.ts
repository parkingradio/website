// Sent by API endpoints, with a 4xx or 5xx status, when a request fails.
export type ApiError = { ok: false; error: string }
