// Response of `GET /api/config`: environment-specific values the client needs.
export type ConfigResponse = {
  // Domain serving the static assets, e.g. `assets.parking.radio`.
  assetsDomain: string
  // The site key of the Cloudflare Turnstile widget. Pages need it to show the widget, which gives them the token that
  // `POST /api/applications` asks for (see applications.ts).
  turnstileSiteKey: string
}
