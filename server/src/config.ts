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
  get bootstrapAdminEmail() {
    return required('BOOTSTRAP_ADMIN_EMAIL')
  },
  get bootstrapAdminPassword() {
    return required('BOOTSTRAP_ADMIN_PASSWORD')
  },
  get awsRegion() {
    return process.env.AWS_REGION
  },
  get mailDomain() {
    return process.env.MAIL_DOMAIN
  },
  // Required: without it the client builds asset URLs against `undefined` and every image on the
  // site breaks, which is much harder to diagnose than failing at startup.
  get assetsDomain() {
    return required('ASSETS_DOMAIN')
  },
  // Credentials of the SoundCloud app the radio's rotation is read through.
  get soundcloudClientId() {
    return required('SOUNDCLOUD_CLIENT_ID')
  },
  get soundcloudClientSecret() {
    return required('SOUNDCLOUD_CLIENT_SECRET')
  },
}
