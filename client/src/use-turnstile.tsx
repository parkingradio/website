import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTurnstileSiteKey } from './config-context'
import { Turnstile } from './turnstile'

// In a file of its own, since a module exporting both a component and a hook breaks Fast Refresh.

// What a form says when it's sent before Turnstile has given it a token.
export const TURNSTILE_PENDING =
  "La vérification anti-robot n'est pas terminée. Attendez quelques secondes, ou rechargez la page si elle n'apparaît pas."

/**
 * A form's Turnstile: `widget`, to show above its button, once the configuration, which has the site key, is fetched, and
 * the `token` it gives once Turnstile vouches for the visitor, which the form sends. `configured` is false while the
 * configuration isn't fetched, or can't be, since no token is coming then. `renew` gets a new token once the form was
 * sent, whatever came of it, since Cloudflare only checks each one once.
 */
export function useTurnstile(): { widget: ReactNode; token: string | null; configured: boolean; renew: () => void } {
  const siteKey = useTurnstileSiteKey()
  const [token, setToken] = useState<string | null>(null)
  // Incremented to get a new token, which takes a new widget.
  const [widget, setWidget] = useState(0)
  return {
    widget: siteKey && <Turnstile key={widget} siteKey={siteKey} onToken={setToken} />,
    token,
    configured: siteKey !== undefined,
    renew: () => {
      setToken(null)
      setWidget((count) => count + 1)
    },
  }
}
