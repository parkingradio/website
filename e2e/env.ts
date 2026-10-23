// What run.sh starts the tests with (see integration-tests/stack.sh).
export function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set: run the tests with e2e/run.sh`)
  return value
}

// The admin run.sh creates when it starts the server (see integration-tests/stack.sh).
export const admin = {
  email: required('ADMIN_EMAIL'),
  password: required('ADMIN_PASSWORD'),
}
