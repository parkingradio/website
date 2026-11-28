import { admin, required } from './env.ts'
import { seed } from './seed.ts'

// Seeds the server under test once, before any test runs, as the admin run.sh creates. The server uses the stand-in for
// SoundCloud, which .env.example sets (see integration-tests/stack.sh).
export default async function globalSetup() {
  await seed({ url: required('BASE_URL'), credentials: admin, soundcloud: true })
}
