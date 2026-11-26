import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, formData } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Loaded } from '../../api/use-api'
import type { Application } from '../../application-fields'
import {
  EMPTY_SESSION_FORM,
  STATUSES,
  applicationLink,
  collectivesApplications,
  findApplication,
  listedSetFields,
  listedSetFromApplication,
  newSetFormValues,
  pickedApplication,
  sessionFormValues,
  setFormValues,
  setValuesFromApplication,
} from '../../session-fields'
import type { ListedSet, Session, SessionStatus, StudioSet } from '../../session-fields'
import type { Artist } from '../../artist-profile'
import { ApplicationWishes } from './application-wishes'
import { Button } from './button'
import {
  ANNOUNCED_LABELS,
  ANNOUNCED_PLURALS,
  MISSING,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_PLURALS,
  SESSION_TYPE_LABELS,
  SET_STATUS_LABELS,
  applicationPath,
  byWhom,
  capitalized,
  compareStarts,
  describePerformanceTypes,
  entryPath,
  flyerUrl,
  formatDuration,
  genreNames,
  raEventKept,
  receivedOn,
  sessionDay,
  sessionHours,
  sessionName,
  sessionSearchFields,
  sessionWhen,
  setDuration,
  setInSentence,
  setName,
  setTitle,
  shownUrl,
} from './describe'
import type { Announced } from './describe'
import { compareText, listedWith, search, useListAddress, useQueryFilter, useSearchQuery, useSort } from './list'
import type { SortColumn, Sorting } from './list'
import { ListPager, SearchField, SortHeader, StatusButtons, StatusFilters, StatusSelect } from './list-controls'
import { ApplicationsFailure, ArtistsFailure, CollectivesFailure, SessionsFailure, ShownImage } from './profile-details'
import { RaEventPanel } from './ra-event'
import { failure, newSessionPath, sessionPath } from './session-errors'
import { SessionForm } from './session-form'
import { CreateSet, MoveSet, REJECTED_CANT_BOOK } from './session-picker'
import type { MovedSet } from './session-picker'
import type { SessionFormProps } from './session-form'
import { Performers, SetLinks, SetsTooLong } from './set-cells'
import { SetFormWithChoices } from './set-form'
import type { InitialSet, TakeoverCollective } from './set-form'
import { DragHandle, SortableList } from './sortable'
import { confirmAnnouncing, useAnnouncing } from './use-announcing'
import type { Announcing } from './use-announcing'
import { arrayMove, useSortableItem } from './use-sortable'

// The sessions section: every session, each one's page, where its status is changed, it's changed or deleted, and so
// are its sets, and adding one.

function BackToSessions({ to = '/admin/sessions' }: { to?: string }) {
  return (
    <Link to={to} className="admin-back">
      ← sessions
    </Link>
  )
}

// What the list of sessions opens on.
const DEFAULT_STATUS: SessionStatus = 'planned'

// The list of sessions as the address says (see `useListAddress`), whose filters also include `announced`.
const useSessionsAddress = () => useListAddress('/admin/sessions', STATUSES, DEFAULT_STATUS, ['announced'])

// The list's filters of announced sessions, after "toutes", and the buttons that announce a session or un-announce it.
const ANNOUNCED_FILTERS: readonly Announced[] = ['true', 'false']
const ANNOUNCED_CHOICES: readonly Announced[] = ['false', 'true']
const announcedOf = (session: Session): Announced => (session.announced ? 'true' : 'false')
// Those of `sessions` with `status`, or that are `announced` or not, or all of them for null.
const withStatus = (sessions: Session[], status: SessionStatus | null) => (status ? sessions.filter((session) => session.status === status) : sessions)
const withAnnounced = (sessions: Session[], announced: Announced | null) =>
  announced ? sessions.filter((session) => announcedOf(session) === announced) : sessions
// Why a session can't be announced, if it can't (see "Announced" in docs/design/server/sessions.md).
const cantAnnounce = (session: Session): string | null => (session.start === null ? "La session n'a pas de date." : null)

// The columns the list of sessions can be sorted by, where statuses are in the order sessions go through them.
type SessionColumn = 'date' | 'name' | 'status'

// The soonest come first in the default view, and the latest otherwise.
function sessionColumns(status: SessionStatus | null): Record<SessionColumn, SortColumn<Session>> {
  return {
    date: { compare: compareStarts, descendingFirst: status !== DEFAULT_STATUS },
    name: { compare: (a, b) => compareText(a.title, b.title) },
    status: { compare: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) },
  }
}

// The performers of a session's sets, set by set.
function SessionArtists({ session }: { session: Session }) {
  return session.sets
    .filter((set) => set.performers.length > 0)
    .map((set, i) => (
      <Fragment key={set.id}>
        {i > 0 && ' · '}
        <Performers performers={set.performers} />
      </Fragment>
    ))
}

// A session's type, e.g. "Guest mixes", which for a takeover links to its collective.
function SessionTypeName({ session }: { session: Session }) {
  const label = SESSION_TYPE_LABELS[session.type]
  return session.takeover ? <Link to={entryPath('collective', session.takeover.id)}>{label}</Link> : label
}

// Sessions, as listed in this section, or on a collective's page, under the heading whose id is `labelledBy`, where the
// type is left out since they're all its takeovers. The columns sort the list when there's `sorting`, and whether
// they're announced is a dropdown that changes it with `announce` (see `useAnnouncing`). The links to the sessions' pages
// keep `linkQuery`, the list they go through, if any.
function SessionsTable({
  sessions,
  sorting,
  announce,
  linkQuery = '',
  labelledBy,
  withType = true,
}: {
  sessions: Session[]
  sorting?: Sorting<SessionColumn>
  announce: (session: Session, announced: Announced) => Promise<void>
  linkQuery?: string
  labelledBy?: string
  withType?: boolean
}) {
  const header = (column: SessionColumn, label: string) =>
    sorting ? (
      <SortHeader column={column} sorting={sorting}>
        {label}
      </SortHeader>
    ) : (
      <th>{label}</th>
    )
  return (
    <table className="admin-table" aria-labelledby={labelledBy}>
      <thead>
        <tr>
          {header('date', 'Date')}
          <th>Heure</th>
          {header('name', 'Nom')}
          {withType && <th>Type</th>}
          <th>Artistes</th>
          {header('status', 'Statut')}
          <th>Annonce</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.id} className={`admin-status-${session.status}`}>
            <td className="admin-day">
              <Link to={sessionPath(session) + linkQuery}>{sessionDay(session)}</Link>
            </td>
            <td className="admin-day">{sessionHours(session)}</td>
            <td>{session.title}</td>
            {withType && (
              <td>
                <SessionTypeName session={session} />
              </td>
            )}
            <td>
              <SessionArtists session={session} />
            </td>
            <td>{SESSION_STATUS_LABELS[session.status]}</td>
            <td>
              <StatusSelect
                label={`Annonce : ${sessionName(session)}`}
                statuses={ANNOUNCED_CHOICES}
                labels={ANNOUNCED_LABELS}
                status={announcedOf(session)}
                unavailable={cantAnnounce(session)}
                onChange={(announced) => announce(session, announced)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// The sessions of a collective's takeovers, on its page, with a link to `newPath`, which adds another one. They're
// announced with `announcing`, which the page keeps, since this unmounts while the collective's form is open.
export function OwnSessions({
  sessions,
  announcing: { current, error, announce },
  newPath,
}: {
  sessions: Loaded<{ sessions: Session[] }>
  announcing: Announcing
  newPath: string
}) {
  const headingId = useId()
  return (
    <>
      <h2 id={headingId}>Sessions</h2>
      <div className="admin-toolbar">
        <Link to={newPath} className="admin-button">
          nouvelle session
        </Link>
      </div>
      {sessions.kind === 'error' && <SessionsFailure message={sessions.message} />}
      <ErrorMessage error={error} />
      {sessions.kind === 'loaded' &&
        (sessions.value.sessions.length === 0 ? (
          <p className="admin-placeholder">Aucune session.</p>
        ) : (
          <SessionsTable sessions={current(sessions.value.sessions)} announce={announce} labelledBy={headingId} withType={false} />
        ))}
    </>
  )
}

// The sets an artist played, whatever their status, among the sets of `sessions`, with their session.
function artistSets(sessions: Session[], artistId: string): { set: StudioSet; session: Session }[] {
  return sessions.flatMap((session) => session.sets.filter((set) => set.performers.some((performer) => performer.id === artistId)).map((set) => ({ set, session })))
}

// The sets of an artist, on their page, with their session, linking to it, where they're only shown.
export function OwnSets({ sessions, artistId }: { sessions: Loaded<{ sessions: Session[] }>; artistId: string }) {
  const headingId = useId()
  const sets = sessions.kind === 'loaded' ? artistSets(sessions.value.sessions, artistId) : []
  return (
    <>
      <h2 id={headingId}>Sets</h2>
      {sessions.kind === 'error' && <SessionsFailure message={sessions.message} />}
      {sessions.kind === 'loaded' &&
        (sets.length === 0 ? (
          <p className="admin-placeholder">Aucun set.</p>
        ) : (
          <table className="admin-table" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Durée</th>
                <th>Session</th>
                <th>Artistes</th>
                <th>Prestation</th>
                <th>Genres</th>
                <th>Liens</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {sets.map(({ set, session }) => (
                <tr key={set.id} className={`admin-status-${set.status}`}>
                  <td className="admin-day">{sessionDay(session)}</td>
                  <td className="admin-day">{setDuration(set)}</td>
                  <td>
                    <Link to={sessionPath(session)}>{session.title}</Link>
                  </td>
                  <td>
                    <Performers performers={set.performers} />
                  </td>
                  <td>{describePerformanceTypes(set)}</td>
                  <td>{genreNames(set.genres)}</td>
                  <td>
                    <SetLinks set={set} />
                  </td>
                  <td>{SET_STATUS_LABELS[set.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </>
  )
}

// The sets that come from an artist's application, on its page, with their sessions, linking to them, where they're only
// shown, like the artist's sets on their page (see `OwnSets`).
// "créer un set" adds another one.
export function ApplicationSets({ application }: { application: Application }) {
  const headingId = useId()
  const { sets } = application
  return (
    <>
      <h2 id={headingId}>Sets</h2>
      <CreateSet application={application} />
      {sets.length === 0 ? (
        <p className="admin-placeholder">Aucun set.</p>
      ) : (
        <table className="admin-table" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Durée</th>
              <th>Session</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((set) => (
              <tr key={set.id} className={`admin-status-${set.status}`}>
                <td className="admin-day">{sessionDay(set.session)}</td>
                <td className="admin-day">{setDuration(set)}</td>
                <td>
                  <Link to={sessionPath(set.session)}>{set.session.title}</Link>
                </td>
                <td>{SET_STATUS_LABELS[set.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

// The sessions that come from a collective's application, on its page, linking to them, where they're only shown.
// "créer une session" adds another one, as the collective's takeover.
export function ApplicationSessions({ application }: { application: Application }) {
  const headingId = useId()
  const { sessions } = application
  return (
    <>
      <h2 id={headingId}>Sessions</h2>
      <div className="admin-toolbar">
        {application.decision === 'rejected' ? (
          <Button unavailable={REJECTED_CANT_BOOK}>créer une session</Button>
        ) : (
          <Link to={newSessionPath({ application: application.id })} className="admin-button">
            créer une session
          </Link>
        )}
      </div>
      {sessions.length === 0 ? (
        <p className="admin-placeholder">Aucune session.</p>
      ) : (
        <table className="admin-table" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Heure</th>
              <th>Nom</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className={`admin-status-${session.status}`}>
                <td className="admin-day">
                  <Link to={sessionPath(session)}>{sessionDay(session)}</Link>
                </td>
                <td className="admin-day">{sessionHours(session)}</td>
                <td>{session.title}</td>
                <td>{SESSION_STATUS_LABELS[session.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

// Every session.
export function SessionsPage() {
  const { query, setQuery } = useSearchQuery()
  return (
    <>
      <h1>Sessions</h1>
      <div className="admin-toolbar">
        <Link to={newSessionPath()} className="admin-button">
          nouvelle session
        </Link>
        <SearchField query={query} onChange={setQuery} />
      </div>
      <SessionsList />
    </>
  )
}

// The sessions, to list them as the address says, which the list and the sessions' pages share: `list` gives those of
// `all` that the search finds, and those of them that the list shows, in its order, with `kept` among them (see
// `listedWith`).
function useSessionList() {
  const sessions = useApi('/api/admin/sessions')
  const { query } = useSearchQuery()
  const address = useSessionsAddress()
  const [announced, setAnnounced] = useQueryFilter('announced', ANNOUNCED_FILTERS)
  const sorting = useSort(sessionColumns(address.status), 'date')
  return {
    sessions,
    address,
    announced,
    setAnnounced,
    sorting,
    list(all: Session[], kept?: Session) {
      const found = search(all, query, sessionSearchFields)
      const shown = new Set(withStatus(withAnnounced(found, announced), address.status))
      return { found, listed: listedWith(all, shown, sorting.sorted, kept) }
    },
  }
}

// The sessions with the status in the `status` query parameter, the default view without one, or every session, and
// those that are announced, or not, as the `announced` query parameter says, or those of them that the search finds. Each
// filter's buttons count the sessions that the search and the other filter find.
function SessionsList() {
  const { sessions, address, announced, setAnnounced, sorting, list } = useSessionList()
  const { current, error, announce } = useAnnouncing()

  if (sessions.kind === 'error') return <SessionsFailure message={sessions.message} />
  if (sessions.kind === 'loading') return null

  const all = current(sessions.value.sessions)
  const { found, listed } = list(all)
  // What the search finds with each filter, which the other one's buttons count.
  const foundAnnounced = withAnnounced(found, announced)
  const foundWithStatus = withStatus(found, address.status)
  let empty = 'Aucune session ne correspond à la recherche.'
  if (all.length === 0) empty = 'Aucune session.'
  else if (listed.length === 0 && withStatus(withAnnounced(all, announced), address.status).length === 0)
    empty = announced ? 'Aucune session ne correspond à ces filtres.' : 'Aucune session avec ce statut.'
  return (
    <>
      <StatusFilters
        all="toutes"
        statuses={STATUSES}
        labels={SESSION_STATUS_PLURALS}
        status={address.status}
        count={(status) => withStatus(foundAnnounced, status).length}
        onChange={address.setStatus}
      />
      <StatusFilters
        label="Annonce"
        all="toutes"
        statuses={ANNOUNCED_FILTERS}
        labels={ANNOUNCED_PLURALS}
        status={announced}
        count={(announced) => withAnnounced(foundWithStatus, announced).length}
        onChange={setAnnounced}
      />
      <ErrorMessage error={error} />
      {listed.length === 0 ? (
        <p className="admin-placeholder">{empty}</p>
      ) : (
        <SessionsTable sessions={listed} sorting={sorting} announce={announce} linkQuery={address.query} />
      )}
    </>
  )
}

function ErrorMessage({ error }: { error: ReactNode }) {
  return (
    error && (
      <p className="admin-error" role="alert">
        {error}
      </p>
    )
  )
}

// A session's page. It starts afresh for each session, rather than showing the last one while the next one loads.
export function SessionPage() {
  const { id } = useParams() as { id: string }
  return <SessionById key={id} id={id} />
}

function SessionById({ id }: { id: string }) {
  const loaded = useApi('/api/admin/sessions/{id}', { params: { path: { id } } })
  return (
    <>
      <SessionLinks id={id} session={loaded} />
      {loaded.kind === 'error' && <ErrorMessage error={`La session n'a pas pu être chargée : ${loaded.message}`} />}
      {loaded.kind === 'loaded' && <LoadedSession loaded={loaded.value.session} />}
    </>
  )
}

// Above a session's title: back to the list, then, when the address gives the list's status, précédente and suivante,
// which go through it, with the `session` as it was when its page opened (see "Going through a list" in
// docs/design/client/admin/layout.md).
function SessionLinks({ id, session }: { id: string; session: Loaded<{ session: Session }> }) {
  const address = useSessionsAddress()
  return (
    <div className="admin-page-links">
      <BackToSessions to={address.listPath} />
      {address.given && session.kind !== 'error' && <SessionListNavigation id={id} session={session.kind === 'loaded' ? session.value.session : undefined} />}
    </div>
  )
}

function SessionListNavigation({ id, session }: { id: string; session: Session | undefined }) {
  const { sessions, address, list } = useSessionList()
  return (
    <ListPager
      id={id}
      listed={session && sessions.kind === 'loaded' ? list(sessions.value.sessions, session).listed : undefined}
      failure={sessions.kind === 'error' ? `La liste des sessions n'a pas pu être chargée\u00a0: ${sessions.message}` : undefined}
      path={(to) => sessionPath(to) + address.query}
    />
  )
}

// The one form open on a session's page, if any: the session's, its event on RA's, a set's, by its id, or a new one's
// (null), which can be filled in from an application, by its id (see "From an application" in
// docs/design/client/admin/sessions.md), or the panel that moves a set to another session, by the set's id.
type OpenForm = { kind: 'session' } | { kind: 'raEvent' } | { kind: 'set'; id: string | null; application?: string } | { kind: 'move'; id: string } | null

function LoadedSession({ loaded }: { loaded: Session }) {
  // The session as the last change left it, which replaces the one loaded.
  const [session, setSession] = useState(loaded)
  // The application a new set is filled in from, unless the session is cancelled, from the page's address, until a form
  // opens or closes.
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState<OpenForm>(() => {
    const application = searchParams.get('application')
    return application && session.status !== 'cancelled' ? { kind: 'set', id: null, application } : null
  })
  const [busy, setBusy] = useState(false)
  // Why the session's status couldn't be changed, or why it couldn't be deleted.
  const [error, setError] = useState<ReactNode>(null)
  // Why whether it's announced couldn't be changed.
  const [announcedError, setAnnouncedError] = useState<ReactNode>(null)
  // Why a set's status couldn't be changed, or why it couldn't be moved or deleted.
  const [setsError, setSetsError] = useState<ReactNode>(null)
  // The set that was just moved to another session, and that session, as the server answered, which the page says.
  const [moved, setMoved] = useState<{ set: StudioSet; to: Session } | null>(null)
  const setsHeadingId = useId()
  // What gets the focus once a set is deleted, or moved to another session, since its row is gone, or once the panel
  // that moves it is closed: a set's button, by the set's id and what the button does, or the heading of the sets.
  const focusNext = useRef<{ id: string; action: 'move' | 'delete' } | 'heading' | null>(null)
  // A layout effect, which React runs in the commit that removes the ×, rather than a passive one, which it runs in a later
  // task when the update follows a request: the focus never falls back to the page in between. After every commit, since
  // it only does something once `focusNext` is set.
  useLayoutEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === 'heading') document.getElementById(setsHeadingId)?.focus()
    else if (next) document.querySelector<HTMLElement>(`[data-set="${next.id}"][data-action="${next.action}"]`)?.focus()
  })
  const navigate = useNavigate()
  const address = useSessionsAddress()
  const params = { path: { id: session.id } }
  // Opens `form`, or closes the one that's open, after which the address doesn't open anything anymore.
  const showForm = (form: OpenForm) => {
    setOpen(form)
    if (!searchParams.has('application')) return
    const params = new URLSearchParams(searchParams)
    params.delete('application')
    setSearchParams(params, { replace: true })
  }
  // Opening a form, or closing one once it's saved, also clears what the page said went wrong, or that a set was moved.
  const openForm = (form: OpenForm) => {
    showForm(form)
    setError(null)
    setAnnouncedError(null)
    clearSetsMessages()
  }
  // What the page says above the sets, which changing one of them clears.
  const clearSetsMessages = () => {
    setSetsError(null)
    setMoved(null)
  }
  const close = () => showForm(null)
  // A change that the server answered with the session as it is now, which closes the form.
  const changed = (session: Session) => {
    setSession(session)
    openForm(null)
  }

  const changeStatus = async (status: SessionStatus) => {
    // Cancelling it cancels its sets that aren't cancelled, played ones included, so they're named, saying which were
    // played, and leaves its event on RA as it is. A session that's already cancelled has nothing to say.
    if (status === 'cancelled' && session.status !== 'cancelled') {
      const uncancelled = session.sets.filter((set) => set.status !== 'cancelled')
      const cancelled = uncancelled.length === 1 ? 'Ce set sera aussi annulé' : 'Ces sets seront aussi annulés'
      const names = uncancelled.map((set) => `• ${setTitle(set)}${set.status === 'done' ? ` (${SET_STATUS_LABELS.done})` : ''}`).join('\n')
      const said = (uncancelled.length > 0 ? `${cancelled}\u00a0:\n${names}\n` : '') + raEventKept(session)
      if (said && !window.confirm(`${said}Annuler la session ?`)) return
    }
    // Marking it done marks its planned sets done, which could be a set that didn't happen, so they're named.
    const planned = session.sets.filter((set) => set.status === 'planned')
    if (status === 'done' && planned.length > 0) {
      const marked = planned.length === 1 ? 'Le set planifié sera aussi marqué comme joué' : 'Les sets planifiés seront aussi marqués comme joués'
      const names = planned.map((set) => `• ${setTitle(set)}`).join('\n')
      if (!window.confirm(`${marked}\u00a0:\n${names}\nMarquer la session comme jouée ?`)) return
    }
    setBusy(true)
    setError(null)
    const result = await api.PUT('/api/admin/sessions/{id}/status', { params, body: { status } })
    setBusy(false)
    if (!result.ok) return setError(failure("Le statut n'a pas pu être changé", result, session.id))
    setSession(result.session)
    // Sets can't be added to a cancelled session.
    if (status === 'cancelled' && open?.kind === 'set' && open.id === null) close()
  }

  const changeAnnounced = async (announced: Announced) => {
    if (!confirmAnnouncing(session, announced)) return
    setBusy(true)
    setAnnouncedError(null)
    const result = await api.PUT('/api/admin/sessions/{id}/announced', { params, body: { announced: announced === 'true' } })
    setBusy(false)
    if (result.ok) setSession(result.session)
    else setAnnouncedError(failure("L'annonce n'a pas pu être changée", result, session.id))
  }

  const changeSetStatus = async (set: StudioSet, status: SessionStatus) => {
    setBusy(true)
    clearSetsMessages()
    const result = await api.PUT('/api/admin/sets/{id}/status', { params: { path: { id: set.id } }, body: { status } })
    setBusy(false)
    if (result.ok) setSession(result.session)
    else setSetsError(failure(`Le statut de «\u00a0${setName(set)}\u00a0» n'a pas pu être changé`, result, session.id))
  }

  // Moves the set at `from` to `to` among the session's sets, once it's dropped there: it shows there right away, while
  // that's saved, then the sets show as the server has them, or the set goes back to where it was.
  const moveSet = async (from: number, to: number) => {
    const before = session
    const set = before.sets[from]
    const moved = { ...before, sets: arrayMove(before.sets, from, to) }
    // Before the request, in the commit that drops the set, so that it never shows back in its place in between. Its
    // handle, which is only aria-disabled while the move is saved, keeps the focus.
    setSession(moved)
    setBusy(true)
    clearSetsMessages()
    const result = await api.PUT('/api/admin/sets/{id}/position', { params: { path: { id: set.id } }, body: { position: to } })
    setBusy(false)
    // Like the page's other answers, the server's replaces the session, whichever came last. Only putting the set back is
    // skipped when another answer replaced the session meanwhile, e.g. a set's form saved, which already has the sets in
    // their order: the session as it was before would visibly undo that save.
    if (result.ok) return setSession(result.session)
    setSession((current) => (current === moved ? before : current))
    setSetsError(failure(`Le set «\u00a0${setName(set)}\u00a0» n'a pas pu être déplacé`, result, session.id))
  }

  // The focus goes to the next set's button that does `action`, or the previous one's, or else to the heading of the sets,
  // once `set` is gone.
  const focusAfterRemoving = (set: StudioSet, action: 'move' | 'delete') => {
    const index = session.sets.findIndex((other) => other.id === set.id)
    const next = session.sets[index + 1] ?? session.sets[index - 1]
    focusNext.current = next ? { id: next.id, action } : 'heading'
  }

  // Once a set is moved to another session, the page shows the session it left, as the server then has it, which can be
  // done now that the set is gone, and says where the set went.
  const movedSet = (set: StudioSet, { session: to, previousSession }: MovedSet) => {
    focusAfterRemoving(set, 'move')
    setSession(previousSession)
    openForm(null)
    setMoved({ set, to })
  }

  const removeSet = async (set: StudioSet) => {
    if (!window.confirm(`Supprimer définitivement ce set (${setName(set)}) ?`)) return
    setBusy(true)
    clearSetsMessages()
    const result = await api.DELETE('/api/admin/sets/{id}', { params: { path: { id: set.id } } })
    setBusy(false)
    if (!result.ok) return setSetsError(failure(`Le set «\u00a0${setName(set)}\u00a0» n'a pas pu être supprimé`, result, session.id))
    focusAfterRemoving(set, 'delete')
    // As the server has it then, which can be done now that the set is gone, without its form, or the panel that moved it.
    setSession(result.session)
    setOpen((open) => (open && 'id' in open && open.id === set.id ? null : open))
  }

  const remove = async () => {
    const sets = session.sets.length
    if (!window.confirm(`${raEventKept(session)}Supprimer définitivement cette session${sets > 0 ? ` et ${sets === 1 ? 'son set' : `ses ${sets} sets`}` : ''} ?`)) return
    setBusy(true)
    setError(null)
    const result = await api.DELETE('/api/admin/sessions/{id}', { params })
    if (result.ok) {
      navigate(address.listPath)
    } else {
      setBusy(false)
      setError(`La session n'a pas pu être supprimée : ${result.error}`)
    }
  }

  const cancelled = session.status === 'cancelled'
  // The set whose panel that moves it to another session is open, if any.
  const moving = open?.kind === 'move' ? session.sets.find((set) => set.id === open.id) : undefined
  return (
    <>
      <h1>{session.title}</h1>
      <p className="admin-meta">{byWhom('Ajoutée', session.createdBy, session.createdAt)}</p>
      {session.updatedBy && <p className="admin-meta">{byWhom('Modifiée', session.updatedBy, session.updatedAt)}</p>}

      <h2>Statut</h2>
      <StatusButtons statuses={STATUSES} labels={SESSION_STATUS_LABELS} status={session.status} disabled={busy} onChange={changeStatus} />
      {session.statusUpdatedBy && <p className="admin-meta">{byWhom('Statut changé', session.statusUpdatedBy, session.statusUpdatedAt)}</p>}
      <ErrorMessage error={error} />
      {/* Whether it's announced, under its status. */}
      <StatusButtons
        label="Annonce"
        statuses={ANNOUNCED_CHOICES}
        labels={ANNOUNCED_LABELS}
        status={announcedOf(session)}
        disabled={busy}
        unavailable={(announced) => (announced === 'true' ? cantAnnounce(session) : null)}
        onChange={changeAnnounced}
      />
      {session.announcedUpdatedBy && <p className="admin-meta">{byWhom('Annonce changée', session.announcedUpdatedBy, session.announcedUpdatedAt)}</p>}
      <ErrorMessage error={announcedError} />

      <h2>Session</h2>
      {open?.kind === 'session' ? (
        <SessionFormWithChoices
          initial={sessionFormValues(session)}
          announced={session.announced}
          status={session.status}
          flyer={session.hasFlyer ? shownUrl(flyerUrl(session)) : null}
          submitLabel="enregistrer"
          onCancel={close}
          onSubmit={async (fields, flyer) => {
            // The fields first, so that a flyer is only saved with fields that are accepted.
            const result = await api.PATCH('/api/admin/sessions/{id}', { params, body: fields })
            if (!result.ok) return failure("La session n'a pas pu être enregistrée", result, session.id)
            setSession(result.session)
            if (flyer) {
              const saved =
                flyer === 'remove'
                  ? await api.DELETE('/api/admin/sessions/{id}/flyer', { params })
                  : await api.PUT('/api/admin/sessions/{id}/flyer', { params, body: { flyer }, bodySerializer: formData })
              // The form stays open, and sending it again sends both again.
              if (!saved.ok) return `La session a été enregistrée, mais pas le flyer : ${saved.error}`
              setSession(saved.session)
            }
            openForm(null)
            return null
          }}
        />
      ) : (
        <>
          <div className="admin-toolbar">
            <button type="button" onClick={() => openForm({ kind: 'session' })}>
              modifier
            </button>
          </div>
          <dl className="admin-record" aria-label="Session">
            <dt>Quand</dt>
            <dd>{sessionWhen(session)}</dd>
            <dt>Durée</dt>
            <dd>{formatDuration(session.durationMinutes)}</dd>
            <dt>Type</dt>
            <dd>{SESSION_TYPE_LABELS[session.type]}</dd>
            {session.takeover && (
              <>
                <dt>Takeover de</dt>
                <dd>
                  <Link to={entryPath('collective', session.takeover.id)}>{session.takeover.name}</Link>
                </dd>
                <dt>Candidature</dt>
                <dd>{session.application ? <Link to={applicationPath(session.application)}>{receivedOn(session.application)}</Link> : MISSING}</dd>
              </>
            )}
            <dt>Nom</dt>
            {/* Faded out when it's the name its type gives it. */}
            <dd className={session.name ? undefined : 'admin-generated'}>{session.title}</dd>
            <dt>Description</dt>
            {/* Faded out when it's the one its type gives it. */}
            <dd className={session.description ? 'admin-text' : 'admin-text admin-generated'}>{session.effectiveDescription || MISSING}</dd>
            <dt>Flyer</dt>
            <dd>{session.hasFlyer ? <ShownImage url={flyerUrl(session)} alt={`Flyer de ${session.title}`} /> : 'Pas de flyer'}</dd>
            <dt>Événement RA</dt>
            <dd>
              {session.raEvent ? (
                linkOrMissing(session.raEvent)
              ) : (
                <>
                  {MISSING}{' '}
                  {open?.kind === 'raEvent' ? (
                    <RaEventPanel session={session} onSaved={changed} onCancel={() => openForm(null)} />
                  ) : (
                    <button type="button" onClick={() => openForm({ kind: 'raEvent' })}>
                      créer
                    </button>
                  )}
                </>
              )}
            </dd>
          </dl>
        </>
      )}

      <h2 id={setsHeadingId} tabIndex={-1}>
        Sets
      </h2>
      <div className="admin-toolbar">
        <Button unavailable={cancelled ? 'La session est annulée\u00a0: on ne peut pas lui ajouter de set.' : null} onClick={() => openForm({ kind: 'set', id: null })}>
          ajouter un set
        </Button>
      </div>
      <ErrorMessage error={setsError} />
      {moved && <MovedNotice {...moved} />}
      <SetsTooLong sets={session.sets} durationMinutes={session.durationMinutes} />
      {session.sets.length === 0 ? (
        <p className="admin-placeholder">Aucun set.</p>
      ) : (
        <SetsTable
          session={session}
          busy={busy}
          onStatus={changeSetStatus}
          onMove={moveSet}
          onMoveTo={(set) => openForm({ kind: 'move', id: set.id })}
          onEdit={(set) => openForm({ kind: 'set', id: set.id })}
          onDelete={removeSet}
        />
      )}
      {open?.kind === 'set' && (
        <OpenSet
          // Afresh for each set, and for a new one filled in from an application or not.
          key={open.id ?? (open.application ? 'application' : 'new')}
          session={session}
          set={session.sets.find((set) => set.id === open.id) ?? null}
          application={open.application}
          onClose={close}
          onChanged={changed}
        />
      )}
      {moving && (
        <MoveSet
          key={moving.id}
          set={moving}
          session={session}
          onCancel={() => {
            // Back to the button that opened it.
            focusNext.current = { id: moving.id, action: 'move' }
            close()
          }}
          onMoved={(result) => movedSet(moving, result)}
        />
      )}

      <h2>Supprimer</h2>
      <p>{deleteText(session)}</p>
      <button type="button" onClick={remove} disabled={busy}>
        supprimer la session
      </button>
    </>
  )
}

// Where a set was just moved to, linking to that session.
function MovedNotice({ set, to }: { set: StudioSet; to: Session }) {
  return (
    <p className="admin-notice" role="status">
      {capitalized(setInSentence(set))} a été déplacé dans la session <Link to={sessionPath(to)}>{sessionName(to)}</Link>.
    </p>
  )
}

// What deleting a session deletes, and what stays.
function deleteText(session: Session): string {
  const sets = session.sets.length > 0
  let deleted = 'La session sera supprimée pour de bon.'
  if (session.hasFlyer && sets) deleted = 'La session, son flyer et ses sets seront supprimés pour de bon.'
  else if (session.hasFlyer) deleted = 'La session et son flyer seront supprimés pour de bon.'
  else if (sets) deleted = 'La session et ses sets seront supprimés pour de bon.'
  const takeover = session.takeover ? 'le collectif de son takeover' : null
  if (!session.sets.some((set) => set.performers.length > 0)) return takeover ? `${deleted} Le collectif de son takeover reste.` : deleted
  return `${deleted} Leurs artistes${takeover ? ` et ${takeover}` : ''} restent.`
}

function linkOrMissing(link: { url: string } | null): ReactNode {
  return link ? (
    <a href={link.url} target="_blank" rel="noreferrer">
      {link.url}
    </a>
  ) : (
    MISSING
  )
}

// A session's sets, in their order, each with a handle that drags it to another place among them (see sortable.tsx), its
// status as a dropdown that changes it, a button that opens the panel that moves it to another session, one that opens
// its form, and one that deletes it. The sets of a cancelled session can't be un-cancelled: their statuses are written
// out instead, and the table says why above them, once.
function SetsTable({
  session,
  busy,
  onStatus,
  onMove,
  onMoveTo,
  onEdit,
  onDelete,
}: {
  session: Session
  busy: boolean
  onStatus: (set: StudioSet, status: SessionStatus) => Promise<void>
  onMove: (from: number, to: number) => void
  onMoveTo: (set: StudioSet) => void
  onEdit: (set: StudioSet) => void
  onDelete: (set: StudioSet) => void
}) {
  const cancelled = session.status === 'cancelled'
  return (
    <>
      {cancelled && <p className="admin-notice">La session est annulée&nbsp;: on ne peut pas rétablir ses sets.</p>}
      {/* Even while the session is cancelled. */}
      <SortableList ids={session.sets.map((set) => set.id)} nameOf={(index) => `«\u00a0${setName(session.sets[index])}\u00a0»`} disabled={busy} onMove={onMove}>
        <table className="admin-table admin-table-controls" aria-label="Sets">
          <thead>
            <tr>
              <th aria-label="Ordre" />
              <th>Durée</th>
              <th>Artistes</th>
              <th>Prestation</th>
              <th>Genres</th>
              <th>Liens</th>
              <th>Statut</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {session.sets.map((set) => (
              <SetRow
                key={set.id}
                set={set}
                cancelled={cancelled}
                busy={busy}
                onStatus={(status) => onStatus(set, status)}
                onMoveTo={() => onMoveTo(set)}
                onEdit={() => onEdit(set)}
                onDelete={() => onDelete(set)}
              />
            ))}
          </tbody>
        </table>
      </SortableList>
    </>
  )
}

// A set's row, colored by its status, which is dragged by its handle to reorder the sets.
function SetRow({
  set,
  cancelled,
  busy,
  onStatus,
  onMoveTo,
  onEdit,
  onDelete,
}: {
  set: StudioSet
  // Whether its session is cancelled, which writes its status out.
  cancelled: boolean
  busy: boolean
  onStatus: (status: SessionStatus) => Promise<void>
  onMoveTo: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { ref, style, dragging, handle } = useSortableItem(set.id)
  return (
    <tr ref={ref} style={style} className={`admin-status-${set.status}`} data-dragging={dragging || undefined}>
      <td>
        <DragHandle handle={handle} label={`réordonner : ${setName(set)}`} />
      </td>
      <td className="admin-day">{setDuration(set)}</td>
      <td>{set.performers.length > 0 ? <Performers performers={set.performers} /> : MISSING}</td>
      <td>{describePerformanceTypes(set)}</td>
      <td>{genreNames(set.genres)}</td>
      <td>
        <SetLinks set={set} />
      </td>
      <td>
        {cancelled ? (
          SET_STATUS_LABELS[set.status]
        ) : (
          <StatusSelect label={`Statut : ${setName(set)}`} statuses={STATUSES} labels={SET_STATUS_LABELS} status={set.status} disabled={busy} onChange={onStatus} />
        )}
      </td>
      <td>
        <button type="button" data-set={set.id} data-action="move" aria-label={`déplacer : ${setName(set)}`} onClick={onMoveTo}>
          déplacer
        </button>{' '}
        <button type="button" aria-label={`modifier : ${setName(set)}`} onClick={onEdit}>
          modifier
        </button>{' '}
        <button type="button" data-set={set.id} data-action="delete" aria-label={`supprimer : ${setName(set)}`} disabled={busy} onClick={onDelete}>
          ×
        </button>
      </td>
    </tr>
  )
}

// The form of a set of `session`, or of a new one when `set` is null, under its sets, which can be filled in from the
// application whose id is `application`. A set's form also says who added it and changed it.
function OpenSet({
  session,
  set,
  application,
  onClose,
  onChanged,
}: {
  session: Session
  set: StudioSet | null
  application?: string
  onClose: () => void
  onChanged: (session: Session) => void
}) {
  const form = (takeover: Loaded<TakeoverCollective> | null) => (
    <SetFormWithChoices
      title={set ? setTitle(set) : 'Nouveau set'}
      initial={set ? setFormValues(set) : application ? setFromApplication(application, session) : newSetFormValues(session)}
      takeover={takeover}
      status={set?.status}
      reveal={application !== undefined}
      submitLabel={set ? 'enregistrer' : 'ajouter le set'}
      onCancel={onClose}
      onSubmit={async (fields) => {
        const result = set
          ? await api.PATCH('/api/admin/sets/{id}', { params: { path: { id: set.id } }, body: fields })
          : await api.POST('/api/admin/sessions/{id}/sets', { params: { path: { id: session.id } }, body: fields })
        if (!result.ok) return failure(set ? "Le set n'a pas pu être enregistré" : "Le set n'a pas pu être ajouté", result, session.id)
        onChanged(result.session)
        return null
      }}
    >
      {set && (
        <>
          <p className="admin-meta">{byWhom('Ajouté', set.createdBy, set.createdAt)}</p>
          {set.updatedBy && <p className="admin-meta">{byWhom('Modifié', set.updatedBy, set.updatedAt)}</p>}
          {set.statusUpdatedBy && <p className="admin-meta">{byWhom('Statut changé', set.statusUpdatedBy, set.statusUpdatedAt)}</p>}
        </>
      )}
    </SetFormWithChoices>
  )
  return session.takeover ? <WithTakeover id={session.takeover.id}>{form}</WithTakeover> : form(null)
}

// What `children` render with a takeover's collective, whose artists its sets' forms offer first, loaded each time it
// shows.
function WithTakeover({ id, children }: { id: string; children: (takeover: Loaded<TakeoverCollective>) => ReactNode }) {
  const loaded = useApi('/api/admin/collectives/{id}', { params: { path: { id } } })
  return children(loaded.kind === 'loaded' ? { kind: 'loaded', value: loaded.value.collective } : loaded)
}

// What a new set of `session` starts with, filled in from the application whose id is `id`, once it's found, with its
// artist, or as a new set when they couldn't be loaded, or nothing when there's no such application, or it's a
// collective's (see "From an application" in docs/design/client/admin/sessions.md).
function setFromApplication(id: string, session: Session): InitialSet {
  return ({ artists, applications }) => {
    const found = findApplication(id, applications, artists)
    if (found === undefined) return newSetFormValues(session)
    return found?.artist ? { ...newSetFormValues(session), ...setValuesFromApplication(found.application, found.artist) } : null
  }
}

// RA events from the year 2000 on, the earliest the server takes, which are every one of Parking Radio's events (see
// "Time ranges" in docs/design/server/ra-events.md).
const EVERY_RA_EVENT_FROM = '2000-01-01T00:00-05:00'

// A new session's form starts from the application whose id is `id`, if it's found among the applications, and, for an
// artist's, its artist among `artists` (see "From an application" in docs/design/client/admin/sessions.md).
type FromApplication = { id: string; artists: Loaded<{ artists: Artist[] }> }

type SessionFormWithChoicesProps = Omit<SessionFormProps, 'collectives' | 'applications' | 'raEvents'> & {
  takeoverId?: string | null
  fromApplication?: FromApplication
}

// The session form, with every collective to pick a takeover's from, and every application, loaded each time it opens,
// so that they're current, and nothing until then, and every event read from RA, which it doesn't wait for. When the
// collectives can't be loaded, it says so. A new session can start as a collective's takeover (`takeoverId`), if it's one
// of them, or from an application, under when its artist would like to play.
function SessionFormWithChoices({
  takeoverId,
  fromApplication,
  initial,
  sets,
  ...props
}: SessionFormWithChoicesProps) {
  const collectives = useApi('/api/admin/collectives')
  const applications = useApi('/api/admin/applications')
  // Asked for along with them, but not waited for.
  const raEvents = useApi('/api/ra-events', { params: { query: { from: EVERY_RA_EVENT_FROM } } })
  if (collectives.kind === 'loading' || applications.kind === 'loading') return null
  const applicationList = applications.kind === 'loaded' ? applications.value.applications : null
  const artists = fromApplication?.artists
  const found = fromApplication && findApplication(fromApplication.id, applicationList, artists?.kind === 'loaded' ? artists.value.artists : null)
  // The artists are only waited for when the application is an artist's.
  if (found === undefined && artists?.kind === 'loading') return null

  const collectiveList = collectives.kind === 'loaded' ? collectives.value.collectives : null
  // A collective's application makes the session its takeover.
  const fromCollective = found?.artist === null ? found.application : null
  const takeover = collectiveList?.find((collective) => collective.id === (fromCollective?.collectiveId ?? takeoverId))
  return (
    <>
      {found && <ApplicationReminder application={found.application} />}
      {/* The applications' failure is said below. */}
      {found === undefined && artists?.kind === 'error' && <ArtistsFailure message={artists.message} />}
      {collectives.kind === 'error' && <CollectivesFailure message={collectives.message} />}
      {applications.kind === 'error' && <ApplicationsFailure message={applications.message} />}
      <SessionForm
        {...props}
        initial={
          takeover
            ? {
                ...initial,
                type: 'takeover',
                takeover: { id: takeover.id, name: takeover.name },
                // From the collective's page, its application is picked as when the collective is picked in the form.
                application: fromCollective
                  ? applicationLink(fromCollective)
                  : pickedApplication(initial.application, applicationList && collectivesApplications(applicationList, takeover), true),
              }
            : initial
        }
        sets={found?.artist ? [listedSetFromApplication(found.application, found.artist)] : sets}
        collectives={collectiveList}
        applications={applicationList}
        raEvents={raEvents}
      />
    </>
  )
}

// Why a new session couldn't be added, with the sets listed in its form, `sets`: the server's message, and when it's
// about one of the sets, which one, and what's in the way, which can be another of them.
function newSessionFailure(
  result: { error: string; session?: Session | null; set?: StudioSet | null; setIndex?: number; otherSetIndex?: number },
  sets: ListedSet[],
): ReactNode {
  const { setIndex, otherSetIndex } = result
  if (setIndex === undefined) return failure("La session n'a pas pu être ajoutée", result)
  const other = otherSetIndex === undefined ? null : setName(sets[otherSetIndex])
  return failure(`${capitalized(setInSentence(sets[setIndex]))} n'a pas pu être ajouté`, result, undefined, other)
}

// Adding a session, as the takeover of the collective in the `takeover` query parameter, unless it isn't known, or from
// the application in the `application` query parameter, with the sets listed in its form.
export function NewSessionPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const applicationId = searchParams.get('application')
  const props: SessionFormWithChoicesProps = {
    takeoverId: searchParams.get('takeover'),
    initial: EMPTY_SESSION_FORM,
    sets: [],
    submitLabel: 'ajouter la session',
    onSubmit: async (fields, flyer, sets) => {
      const body = { session: { ...fields, sets: sets.map(listedSetFields) }, flyer: flyer instanceof File ? flyer : undefined }
      const result = await api.POST('/api/admin/sessions', { body, bodySerializer: formData })
      if (!result.ok) return newSessionFailure(result, sets)
      navigate(sessionPath(result.session))
      return null
    },
  }
  return (
    <>
      <BackToSessions />
      <h1>Nouvelle session</h1>
      {applicationId ? <NewSessionFromApplication key={applicationId} id={applicationId} {...props} /> : <SessionFormWithChoices {...props} />}
    </>
  )
}

// A new session from the application whose id is `id`, with the artists loaded along with what the form loads, to name
// an artist's.
function NewSessionFromApplication({ id, ...props }: SessionFormWithChoicesProps & { id: string }) {
  const artists = useApi('/api/admin/artists')
  return <SessionFormWithChoices {...props} fromApplication={{ id, artists }} />
}

// When the artist of the application a new session comes from would like to play, which doesn't fill in its times, and
// a link to the application, which opens in a new tab, so that the form isn't left.
function ApplicationReminder({ application }: { application: Application }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Candidature</h2>
      <p className="admin-meta">
        <Link to={applicationPath(application)} target="_blank" rel="noreferrer">
          {capitalized(receivedOn(application))}
        </Link>
      </p>
      <dl className="admin-record">
        <ApplicationWishes application={application} />
      </dl>
    </section>
  )
}
