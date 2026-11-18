// How the public pages mark a public event that's cancelled (see docs/design/server/events.md), which stays listed: the
// way RA marks its cancelled events, e.g. "[CANCELLED] GUEST MIXES".
export const CANCELLED = '[CANCELLED]'

export function withCancelled(text: string, cancelled: boolean): string {
  return cancelled ? `${CANCELLED} ${text}` : text
}
