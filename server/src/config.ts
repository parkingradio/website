function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  get isProduction() {
    return process.env.NODE_ENV === 'production'
  },
  get port() {
    return Number(process.env.PORT ?? 3000)
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
  // Where the site is, e.g. for links to it: the deployment's domain, or else the Vite dev server (see the README).
  get siteOrigin() {
    const domain = process.env.MAIL_DOMAIN
    return domain ? `https://${domain}` : 'http://localhost:5173'
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
  // The keys of the Cloudflare Turnstile widget that keeps bots from sending applications (see turnstile.ts). Required,
  // so that applications are never accepted without it.
  get turnstileSiteKey() {
    return required('TURNSTILE_SITE_KEY')
  },
  get turnstileSecretKey() {
    return required('TURNSTILE_SECRET_KEY')
  },
}
