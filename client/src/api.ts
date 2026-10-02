import type { ApiError } from 'shared/error'

/**
 * POSTs `body` to `url` as JSON and returns the server's response. Failures, including those that never
 * reach the server, come back as an `ApiError` rather than being thrown, so that callers only have to
 * check `ok`.
 */
export async function postJson<Request, Response extends { ok: true }>(
  url: string,
  body: Request,
): Promise<Response | ApiError> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result: Response | ApiError = await response.json()
    return result.ok ? result : { ok: false, error: result.error ?? 'Erreur inconnue' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
