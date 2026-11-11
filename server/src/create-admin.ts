import { adminsStore, createAdmin } from './admins/store.js'
import { EMAIL_MAX_LENGTH, isEmailAddress } from './artists/profile.js'
import { config } from './core/config.js'
import { db } from './db/connection.js'

// The create-admin command: invites an admin and prints the invite link, whether they're a new admin, one who hasn't
// accepted their invite yet, or one who has, whose password the link then resets. See createAdmin in admins/store.ts.
//
// It runs with the server's configuration, against the server's database: in production, inside the server's container
// (see tools/create-admin), and in development, with `npm run create-admin -w server -- <email>`.

const args = process.argv.slice(2)
// Like the addresses admins are invited with from the admin pages (see admins/routes.ts), but not trimmed.
if (args.length !== 1 || !isEmailAddress(args[0]) || args[0].length > EMAIL_MAX_LENGTH) {
  console.error(args.length === 1 ? `Not an email address: ${args[0]}` : 'usage: create-admin <email>')
  process.exit(2)
}

try {
  console.log(await createAdmin(adminsStore(db), args[0], config.siteOrigin))
} catch (error) {
  console.error('Failed to create the invite:', error)
  process.exitCode = 1
} finally {
  await db.$client.end()
}
