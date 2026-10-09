import type { Features } from './features.ts'

// Response of `GET /api/config`: environment-specific values the client needs, and which features are on.
export type ConfigResponse = {
  // Domain serving the static assets, e.g. `assets.parking.radio`.
  assetsDomain: string
  // The site key of the Cloudflare Turnstile widget. Pages need it to show the widget, which gives them the token that
  // `POST /api/applications` asks for (see applications.ts).
  turnstileSiteKey: string
  // Whether each feature flag is on (see features.ts). It's empty, so every flag is off, if the server can't read them.
  features: Features
}
