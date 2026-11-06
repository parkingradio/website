import { Link } from 'react-router'
import type { ReactNode } from 'react'
import type { Session, StudioSet } from '../../session-fields'
import { sessionName, setName } from './describe'

// What the admin pages say of sessions when the server refuses something because of one, e.g. a session's 409 (see
// "Errors" in docs/design/client/admin/sessions.md), and where they link to.

export function sessionPath(session: Pick<Session, 'id'>): string {
  return `/admin/sessions/${session.id}`
}

// Why something couldn't be done (`what`): the server's message, and what's in the way, if it names something, linking to
// its session's page, unless that's the page of the session whose id is `here`, where a set is named without a link, and
// the session itself isn't named.
export function failure(what: string, result: { error: string; session?: Session | null; set?: StudioSet | null }, here?: string): ReactNode {
  const { session, set } = result
  let named: ReactNode = null
  if (session && set) named = session.id === here ? setName(set) : <Link to={sessionPath(session)}>{setName(set, session)}</Link>
  else if (session && session.id !== here) named = <Link to={sessionPath(session)}>{sessionName(session)}</Link>
  return (
    <>
      {what}&nbsp;: {result.error}
      {named && <> ({named})</>}
    </>
  )
}
