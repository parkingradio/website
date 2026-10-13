import { useEffect, useEffectEvent, useRef } from 'react'

// Cloudflare Turnstile's widget, which gets the token that `POST /api/applications` needs to tell people from
// bots. https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type RenderOptions = {
  sitekey: string
  language: string
  appearance: 'always' | 'execute' | 'interaction-only'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

// The parts of Turnstile's API that the form uses.
export type TurnstileApi = {
  render(container: HTMLElement, options: RenderOptions): string
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null

// Turnstile's API, once its script has loaded: right away when it already has.
function loadTurnstile(): TurnstileApi | Promise<TurnstileApi> {
  if (window.turnstile) return window.turnstile
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')))
    script.onerror = () => {
      // Tried again the next time the form is shown.
      loading = null
      reject(new Error('Turnstile could not be loaded'))
    }
    document.head.append(script)
  })
  return loading
}

type Props = {
  siteKey: string
  // Called with each token the widget gets, and with null once the last one can't be used anymore. Turnstile gets a new
  // token on its own before one expires, so this is only null for a while, e.g. when Turnstile is unreachable. A token
  // can only be checked once, so getting another one takes another widget, e.g. by changing the component's `key`.
  onToken: (token: string | null) => void
}

export function Turnstile({ siteKey, onToken }: Props) {
  const container = useRef<HTMLDivElement>(null)
  // The latest `onToken`, without rendering the widget again when it changes.
  const token = useEffectEvent((value: string | null) => onToken(value))

  useEffect(() => {
    let cancelled = false
    let widget: string | null = null
    const render = (turnstile: TurnstileApi) => {
      if (cancelled || !container.current) return
      widget = turnstile.render(container.current, {
        sitekey: siteKey,
        language: 'fr',
        // Only shown when Cloudflare needs the artist to click it.
        appearance: 'interaction-only',
        callback: (value) => token(value),
        'expired-callback': () => token(null),
        'error-callback': () => token(null),
      })
    }
    const turnstile = loadTurnstile()
    if (turnstile instanceof Promise) {
      // Without the script, there's no token: the form says so when the artist tries to send it.
      turnstile.then(render, () => {})
    } else {
      render(turnstile)
    }
    return () => {
      cancelled = true
      if (widget) window.turnstile?.remove(widget)
    }
  }, [siteKey])

  return <div ref={container} className="turnstile" />
}
