import type { ApiError } from 'shared/error'

/**
 * Sends a request to the API and returns the server's response, with `ok: true` if it succeeded. Failures,
 * including those that never reach the server, come back as an `ApiError` rather than being thrown, so that
 * callers only have to check `ok`.
 */
async function requestJson<Response>(url: string, init?: RequestInit): Promise<(Response & { ok: true }) | ApiError> {
  try {
    const response = await fetch(url, init)
    const result: Response | ApiError = await response.json()
    if (response.ok) return { ...result, ok: true } as Response & { ok: true }
    return { ok: false, error: (result as ApiError).error ?? 'Erreur inconnue' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** GETs `url`, like `postJson`. */
export async function getJson<Response>(url: string): Promise<(Response & { ok: true }) | ApiError> {
  return requestJson(url)
}

/** POSTs `body` to `url` as JSON and returns the server's response, or an `ApiError` if anything fails. */
export async function postJson<Request, Response>(
  url: string,
  body: Request,
): Promise<(Response & { ok: true }) | ApiError> {
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** PUTs `body` to `url` as JSON, like `postJson`. */
export async function putJson<Request, Response>(url: string, body: Request): Promise<(Response & { ok: true }) | ApiError> {
  return requestJson(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** DELETEs `url`, like `postJson`. */
export async function deleteJson<Response>(url: string): Promise<(Response & { ok: true }) | ApiError> {
  return requestJson(url, { method: 'DELETE' })
}

/**
 * Sends `form` to `url` as multipart/form-data, e.g. with a file, like `postJson`. The browser sets the
 * Content-Type, since it includes the boundary between the parts.
 */
export async function sendForm<Response>(
  method: 'POST' | 'PUT',
  url: string,
  form: FormData,
): Promise<(Response & { ok: true }) | ApiError> {
  return requestJson(url, { method, body: form })
}
