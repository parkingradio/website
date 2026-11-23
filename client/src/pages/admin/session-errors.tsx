import { Link } from 'react-router'
import type { ReactNode } from 'react'
import type { Session, StudioSet } from '../../session-fields'
import { sessionName, setName } from './describe'

// What the admin pages say of sessions when the server refuses something because of one, e.g. a session's 409 (see
// "Errors" in docs/design/client/admin/sessions.md), and where they link to.

export function sessionPath(session: Pick<Session, 'id'>): string {
  return `/admin/sessions/${session.id}`
}

// The address of "nouvelle session", as the takeover of a collective, or from an application, by their ids (see "The
// session form" and "From an application" in docs/design/client/admin/sessions.md).
export function newSessionPath(from: { takeover?: string; application?: string } = {}): string {
  const query = new URLSearchParams(Object.entries(from).filter((entry): entry is [string, string] => entry[1] !== undefined))
  return `/admin/sessions/nouvelle${query.size > 0 ? `?${query}` : ''}`
}

// Why something couldn't be done (`what`): the server's message, and what's in the way, if it names something, linking to
// its session's page, unless that's the page of the session whose id is `here`, where a set is named without a link, and
// the session itself isn't named. What's in the way can also be given as it's `named`, when the server doesn't name it,
// e.g. another of the sets listed in a new session's form.
export function failure(
  what: string,
  result: { error: string; session?: Session | null; set?: StudioSet | null },
  here?: string,
  named: ReactNode = null,
): ReactNode {
  const { session, set } = result
  if (session && set) named = session.id === here ? setName(set) : <Link to={sessionPath(session)}>{setName(set, session)}</Link>
  else if (session && session.id !== here) named = <Link to={sessionPath(session)}>{sessionName(session)}</Link>
  return (
    <>
      {what}&nbsp;: {result.error}
      {named && <> ({named})</>}
    </>
  )
}
