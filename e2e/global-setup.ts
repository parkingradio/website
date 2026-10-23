import { admin, required } from './env.ts'
import { seed } from './seed.ts'

// Seeds the server under test once, before any test runs, as the admin run.sh creates.
export default async function globalSetup() {
  await seed({ url: required('BASE_URL'), credentials: admin })
}
