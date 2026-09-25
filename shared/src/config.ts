// Response of `GET /api/config`: environment-specific values the client needs.
export type ConfigResponse = {
  // Domain serving the static assets, e.g. `assets.parking.radio`.
  assetsDomain: string
}
