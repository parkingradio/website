// Postgres fails when asked for an id that isn't a UUID, instead of finding nothing. Stores check ids with this first,
// and treat other ids as not found.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(id: string): boolean {
  return UUID.test(id)
}
