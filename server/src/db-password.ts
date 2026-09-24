import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

// Returns a function fetching the password from an RDS-managed Secrets Manager secret, whose value is
// a JSON object holding (among other things) the password. RDS rotates that secret periodically, so
// the password is fetched every time rather than read once at startup.
export function secretsManagerPassword(secretId: string, region: string | undefined): () => Promise<string> {
  const client = new SecretsManagerClient({ region })

  return async () => {
    const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
    const password = SecretString ? JSON.parse(SecretString).password : undefined
    if (typeof password !== 'string') {
      throw new Error(`Secret ${secretId} does not contain a password`)
    }
    return password
  }
}
