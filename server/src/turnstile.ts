// Cloudflare Turnstile keeps bots from sending applications. Once a visitor passes Turnstile's check on a page, the
// page gets a token from Cloudflare. Before accepting the application, the server asks Cloudflare whether that token is
// valid. Each token can only be checked once, and only within 5 minutes.
//
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TIMEOUT_MS = 10_000
// Longer tokens can't have come from Cloudflare.
const MAX_TOKEN_LENGTH = 2048

// Asks Cloudflare whether the token, sent by the visitor at `remoteIp`, is valid. If it isn't, `errorCodes` gives
// Cloudflare's reasons, one of which is a wrong secret key. Throws if Cloudflare can't be reached or has an internal
// error, since neither says anything about the visitor.
export type TurnstileVerifier = (token: string, remoteIp: string) => Promise<{ success: true } | { success: false; errorCodes: string[] }>

export function turnstileVerifier(secretKey: string): TurnstileVerifier {
  return async (token, remoteIp) => {
    // Cloudflare would refuse these anyway, so there's no need to ask.
    if (!token) return { success: false, errorCodes: ['missing-input-response'] }
    if (token.length > MAX_TOKEN_LENGTH) return { success: false, errorCodes: ['invalid-input-response'] }
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: token, remoteip: remoteIp }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Turnstile responded with ${response.status}`)
    const result = (await response.json()) as { success?: unknown; 'error-codes'?: unknown }
    if (result.success === true) return { success: true }
    const errorCodes = Array.isArray(result['error-codes']) ? result['error-codes'].map(String) : []
    if (errorCodes.includes('internal-error')) throw new Error('Turnstile had an internal error')
    return { success: false, errorCodes }
  }
}
