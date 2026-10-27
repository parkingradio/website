function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  get isProduction() {
    return process.env.NODE_ENV === 'production'
  },
  // SERVER_PORT, in a checkout's .env (see "Several checkouts" in the README), or else PORT, e.g. in production. PORT
  // alone isn't enough for checkouts, since tools commonly set it for themselves, and what's set takes precedence over
  // .env, which would give every checkout the same port.
  get port() {
    return Number(process.env.SERVER_PORT || process.env.PORT || 3000)
  },
  // The name of the cookie that holds an admin's session. Browsers share cookies between all of localhost's ports, so in
  // development, it has the server's port in it, so that checkouts running side by side don't take each other's
  // sessions (see "Several checkouts" in the README).
  get sessionCookie() {
    return this.isProduction ? 'session' : `session-${this.port}`
  },
  get databaseUrl() {
    return required('DATABASE_URL')
  },
  // When set, the database password is read from this Secrets Manager secret (and re-read whenever
  // it gets rotated).
  get databasePasswordSecretId() {
    return process.env.DATABASE_PASSWORD_SECRET_ID
  },
  get databaseSslCa() {
    return process.env.DATABASE_SSL_CA
  },
  get jwtSecret() {
    return required('JWT_SECRET')
  },
  get awsRegion() {
    return process.env.AWS_REGION
  },
  get mailDomain() {
    return process.env.MAIL_DOMAIN
  },
  // Where the site is, e.g. for links to it: the deployment's domain, or else the Vite dev server, on CLIENT_PORT (see the
  // README).
  get siteOrigin() {
    const domain = process.env.MAIL_DOMAIN
    return domain ? `https://${domain}` : `http://localhost:${process.env.CLIENT_PORT || 5173}`
  },
  // Where the app keeps its private files, e.g. artists' photos: the private S3 bucket, or else a local directory that
  // stands in for it (e.g. in development). One of the two is required, so that a missing bucket doesn't go unnoticed
  // until the first file.
  get privateFiles(): { bucket: string } | { directory: string } {
    const bucket = process.env.PRIVATE_BUCKET
    if (bucket) return { bucket }
    const directory = process.env.PRIVATE_BUCKET_DIRECTORY
    if (directory) return { directory }
    throw new Error('Missing required environment variable: PRIVATE_BUCKET (or PRIVATE_BUCKET_DIRECTORY)')
  },
  // Required: without it the client builds asset URLs against `undefined` and every image on the
  // site breaks, which is much harder to diagnose than failing at startup.
  get assetsDomain() {
    return required('ASSETS_DOMAIN')
  },
  // The keys of the Cloudflare Turnstile widget that keeps bots from sending applications (see
  // applications/turnstile.ts). Required, so that applications are never accepted without it.
  get turnstileSiteKey() {
    return required('TURNSTILE_SITE_KEY')
  },
  get turnstileSecretKey() {
    return required('TURNSTILE_SECRET_KEY')
  },
}
