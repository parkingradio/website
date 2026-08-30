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
}
