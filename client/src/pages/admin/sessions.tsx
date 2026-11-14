import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, formData } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Loaded } from '../../api/use-api'
import type { Application } from '../../application-fields'
import { raEventId } from '../../session-links'
import { EMPTY_SESSION_FORM, STATUSES, newSetFormValues, sessionFormValues, setFormValues } from '../../session-fields'
import type { Session, SessionStatus, StudioSet } from '../../session-fields'
import { Button } from './button'
import {
  MISSING,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_PLURALS,
  SESSION_TYPE_LABELS,
  SET_STATUS_LABELS,
  applicationPath,
  byWhom,
  describePerformanceTypes,
  entryPath,
  flyerUrl,
  formatDuration,
  genreNames,
  receivedOn,
  sessionDay,
  sessionHours,
  sessionLongDay,
  sessionWhen,
  setHours,
  setInSentence,
  setName,
  setTitle,
} from './describe'
import { compareText, search, useSearchQuery, useSort, useStatusFilter } from './list'
import type { SortColumn, Sorting } from './list'
import { SearchField, SortHeader, StatusButtons, StatusFilters } from './list-controls'
import { ApplicationsFailure, ArtistsFailure, CollectivesFailure } from './profile-details'
import { RaEventPanel } from './ra-event'
import { failure, sessionPath } from './session-errors'
import { SessionForm } from './session-form'
import type { SessionFormProps } from './session-form'
import { SetForm } from './set-form'

// The sessions section: every session, each one's page, where its status is changed, it's changed or deleted, and so
// are its sets, and adding one.

function BackToSessions() {
  return (
    <Link to="/admin/sessions" className="admin-back">
      ← sessions
    </Link>
  )
}

// What the list of sessions opens on.
const DEFAULT_STATUS: SessionStatus = 'planned'

// The columns the list of sessions can be sorted by, where statuses are in the order sessions go through them.
type SessionColumn = 'date' | 'name' | 'status'

// Sessions without a date are later than any other, then by when they were added.
function compareStarts(a: Session, b: Session): number {
  const start = (session: Session) => (session.start === null ? Infinity : Date.parse(session.start))
  return start(a) - start(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt)
}

// The soonest come first in the default view, and the latest otherwise.
function sessionColumns(status: SessionStatus | null): Record<SessionColumn, SortColumn<Session>> {
  return {
    date: { compare: compareStarts, descendingFirst: status !== DEFAULT_STATUS },
    name: { compare: (a, b) => compareText(a.title, b.title) },
    status: { compare: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) },
  }
}

function SessionsFailure({ message }: { message: string }) {
  return (
    <p className="admin-error" role="alert">
      Les sessions n'ont pas pu être chargées&nbsp;: {message}
    </p>
  )
}

// Performers, each linking to their page, separated by commas.
function Performers({ performers }: { performers: StudioSet['performers'] }) {
  return performers.map((performer, i) => (
    <Fragment key={performer.id}>
      {i > 0 && ', '}
      <Link to={entryPath('artist', performer.id)}>{performer.name}</Link>
    </Fragment>
  ))
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
// type is left out since they're all its takeovers. The columns sort the list when there's `sorting`.
function SessionsTable({
  sessions,
  sorting,
  labelledBy,
  withType = true,
}: {
  sessions: Session[]
  sorting?: Sorting<SessionColumn>
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
            {withType && (
              <td>
                <SessionTypeName session={session} />
              </td>
            )}
            <td>
              <SessionArtists session={session} />
            </td>
            <td>{SESSION_STATUS_LABELS[session.status]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// The sessions of a collective's takeovers, on its page, with a link to `newPath`, which adds another one.
export function OwnSessions({ sessions, newPath }: { sessions: Loaded<{ sessions: Session[] }>; newPath: string }) {
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
      {sessions.kind === 'loaded' &&
        (sessions.value.sessions.length === 0 ? (
          <p className="admin-placeholder">Aucune session.</p>
        ) : (
          <SessionsTable sessions={sessions.value.sessions} labelledBy={headingId} withType={false} />
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
                <th>Heure</th>
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
                  <td className="admin-day">{setHours(set)}</td>
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
export function ApplicationSets({ sets }: { sets: Application['sets'] }) {
  const headingId = useId()
  return (
    <>
      <h2 id={headingId}>Sets</h2>
      {sets.length === 0 ? (
        <p className="admin-placeholder">Aucun set ne vient de cette candidature&nbsp;: on la choisit dans le formulaire d'un set de l'artiste.</p>
      ) : (
        <table className="admin-table" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Heure</th>
              <th>Session</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((set) => (
              <tr key={set.id} className={`admin-status-${set.status}`}>
                <td className="admin-day">{sessionDay(set.session)}</td>
                <td className="admin-day">{setHours(set)}</td>
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

// The sessions that come from a collective's application, on its page, linking to them, where they're only shown, like
// the collective's sessions on its page (see `OwnSessions`).
export function ApplicationSessions({ sessions }: { sessions: Application['sessions'] }) {
  const headingId = useId()
  return (
    <>
      <h2 id={headingId}>Sessions</h2>
      {sessions.length === 0 ? (
        <p className="admin-placeholder">
          Aucune session ne vient de cette candidature&nbsp;: on la choisit dans le formulaire d'un takeover du collectif.
        </p>
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
        <Link to="/admin/sessions/nouvelle" className="admin-button">
          nouvelle session
        </Link>
        <SearchField query={query} onChange={setQuery} />
      </div>
      <SessionsList query={query} />
    </>
  )
}

// What a session is searched by: its title, its type, its takeover's collective, its sets' performers, and its day,
// written out, e.g. "samedi 14 novembre 2026", so that "novembre" or "samedi" finds it, or "date à déterminer".
function sessionSearchFields(session: Session): string[] {
  return [
    session.title,
    SESSION_TYPE_LABELS[session.type],
    session.takeover?.name ?? '',
    ...session.sets.flatMap((set) => set.performers.map((performer) => performer.name)),
    sessionLongDay(session),
  ].filter(Boolean)
}

// The sessions with the status in the `status` query parameter, the default view without one, or every session, or those
// of them that `query` finds. The status's buttons count the sessions the search finds.
function SessionsList({ query }: { query: string }) {
  const sessions = useApi('/api/admin/sessions')
  const [status, setStatus] = useStatusFilter(STATUSES, DEFAULT_STATUS)
  const sorting = useSort(sessionColumns(status), 'date')

  if (sessions.kind === 'error') return <SessionsFailure message={sessions.message} />
  if (sessions.kind === 'loading') return null

  const all = sessions.value.sessions
  const found = search(all, query, sessionSearchFields)
  const withStatus = (sessions: Session[]) => (status ? sessions.filter((session) => session.status === status) : sessions)
  const listed = sorting.sorted(withStatus(found))
  return (
    <>
      <StatusFilters
        all="toutes"
        statuses={STATUSES}
        labels={SESSION_STATUS_PLURALS}
        status={status}
        count={(status) => (status ? found.filter((session) => session.status === status) : found).length}
        onChange={setStatus}
      />
      {listed.length === 0 ? (
        <p className="admin-placeholder">
          {all.length === 0 ? 'Aucune session.' : withStatus(all).length === 0 ? 'Aucune session avec ce statut.' : 'Aucune session ne correspond à la recherche.'}
        </p>
      ) : (
        <SessionsTable sessions={listed} sorting={sorting} />
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
  if (loaded.kind === 'loading') return <BackToSessions />
  if (loaded.kind === 'error') {
    return (
      <>
        <BackToSessions />
        <ErrorMessage error={`La session n'a pas pu être chargée : ${loaded.message}`} />
      </>
    )
  }
  return <LoadedSession loaded={loaded.value.session} />
}

// The one form open on a session's page, if any: the session's, its event on RA's, or a set's, by its id, or a new one's
// (null).
type OpenForm = { kind: 'session' } | { kind: 'raEvent' } | { kind: 'set'; id: string | null } | null

function LoadedSession({ loaded }: { loaded: Session }) {
  // The session as the last change left it, which replaces the one loaded.
  const [session, setSession] = useState(loaded)
  // The event on RA that the bookmarklet just created for the session, from the address it led back to (see
  // docs/design/client/admin/publier-sur-ra.md), while it has none. It opens the panel of its event on RA with it, until
  // a form opens or closes: only saving it saves it.
  const [searchParams, setSearchParams] = useSearchParams()
  const created = session.raEvent ? null : raEventId(searchParams.get('raEvent') ?? '')
  const [open, setOpen] = useState<OpenForm>(created ? { kind: 'raEvent' } : null)
  const [busy, setBusy] = useState(false)
  // Why the session's status couldn't be changed, or why it couldn't be deleted.
  const [error, setError] = useState<ReactNode>(null)
  // Why a set's status couldn't be changed, or why it couldn't be deleted.
  const [setsError, setSetsError] = useState<ReactNode>(null)
  const setsHeadingId = useId()
  // What gets the focus once a set is deleted, since its × is gone: another set's ×, by the set's id, or the heading of
  // the sets.
  const focusAfterDelete = useRef<string | null>(null)
  // A layout effect, which React runs in the commit that removes the ×, rather than a passive one, which it runs in a later
  // task when the update follows a request: the focus never falls back to the page in between.
  useLayoutEffect(() => {
    const next = focusAfterDelete.current
    focusAfterDelete.current = null
    if (next === 'heading') document.getElementById(setsHeadingId)?.focus()
    else if (next) document.querySelector<HTMLElement>(`[data-delete="${next}"]`)?.focus()
  }, [session, setsHeadingId])
  const navigate = useNavigate()
  const params = { path: { id: session.id } }
  const openForm = (form: OpenForm) => {
    setOpen(form)
    setError(null)
    setSetsError(null)
    if (!searchParams.has('raEvent')) return
    const params = new URLSearchParams(searchParams)
    params.delete('raEvent')
    setSearchParams(params, { replace: true })
  }
  // A change that the server answered with the session as it is now, which closes the form.
  const changed = (session: Session) => {
    setSession(session)
    openForm(null)
  }

  const changeStatus = async (status: SessionStatus) => {
    const uncancelled = session.sets.filter((set) => set.status !== 'cancelled').length
    if (status === 'cancelled' && uncancelled > 0) {
      const sets = uncancelled === 1 ? "son set qui ne l'est pas" : `ses ${uncancelled} sets qui ne le sont pas`
      if (!window.confirm(`Annuler la session annule aussi ${sets}. Annuler la session ?`)) return
    }
    setBusy(true)
    setError(null)
    const result = await api.PUT('/api/admin/sessions/{id}/status', { params, body: { status } })
    setBusy(false)
    if (!result.ok) return setError(failure("Le statut n'a pas pu être changé", result, session.id))
    setSession(result.session)
    // Sets can't be added to a cancelled session.
    if (status === 'cancelled' && open?.kind === 'set' && open.id === null) setOpen(null)
  }

  const changeSetStatus = async (set: StudioSet, status: SessionStatus) => {
    setBusy(true)
    setSetsError(null)
    const result = await api.PUT('/api/admin/sets/{id}/status', { params: { path: { id: set.id } }, body: { status } })
    setBusy(false)
    if (result.ok) setSession(result.session)
    else setSetsError(failure(`Le statut de «\u00a0${setName(set)}\u00a0» n'a pas pu être changé`, result, session.id))
  }

  const removeSet = async (set: StudioSet) => {
    if (!window.confirm(`Supprimer définitivement ce set (${setName(set)}) ?${set.performers.length > 0 ? ' Ses artistes restent.' : ''}`)) return
    setBusy(true)
    setSetsError(null)
    const result = await api.DELETE('/api/admin/sets/{id}', { params: { path: { id: set.id } } })
    setBusy(false)
    if (!result.ok) return setSetsError(failure(`Le set «\u00a0${setName(set)}\u00a0» n'a pas pu être supprimé`, result, session.id))
    // The focus goes to the next set's ×, or the previous one's, or else to the heading of the sets.
    const index = session.sets.findIndex((other) => other.id === set.id)
    focusAfterDelete.current = (session.sets[index + 1] ?? session.sets[index - 1])?.id ?? 'heading'
    // The other sets don't overlap it anymore.
    setSession((session) => ({
      ...session,
      sets: session.sets.filter((other) => other.id !== set.id).map((other) => ({ ...other, overlappingSets: other.overlappingSets.filter((id) => id !== set.id) })),
    }))
    setOpen((open) => (open?.kind === 'set' && open.id === set.id ? null : open))
  }

  const remove = async () => {
    const sets = session.sets.length
    if (!window.confirm(`Supprimer définitivement cette session${sets > 0 ? ` et ${sets === 1 ? 'son set' : `ses ${sets} sets`}` : ''} ?`)) return
    setBusy(true)
    setError(null)
    const result = await api.DELETE('/api/admin/sessions/{id}', { params })
    if (result.ok) {
      navigate('/admin/sessions')
    } else {
      setBusy(false)
      setError(`La session n'a pas pu être supprimée : ${result.error}`)
    }
  }

  const cancelled = session.status === 'cancelled'
  return (
    <>
      <BackToSessions />
      <h1>{session.title}</h1>
      <p className="admin-meta">{byWhom('Ajoutée', session.createdBy, session.createdAt)}</p>
      {session.updatedBy && <p className="admin-meta">{byWhom('Modifiée', session.updatedBy, session.updatedAt)}</p>}

      <h2>Statut</h2>
      <StatusButtons statuses={STATUSES} labels={SESSION_STATUS_LABELS} status={session.status} disabled={busy} onChange={changeStatus} />
      {session.statusUpdatedBy && <p className="admin-meta">{byWhom('Changé', session.statusUpdatedBy, session.statusUpdatedAt)}</p>}
      <ErrorMessage error={error} />

      <h2>Session</h2>
      {open?.kind === 'session' ? (
        <SessionFormWithChoices
          initial={sessionFormValues(session)}
          hasSets={session.sets.length > 0}
          flyer={session.hasFlyer ? flyerUrl(session) : null}
          submitLabel="enregistrer"
          onCancel={() => setOpen(null)}
          onSubmit={async (body) => {
            const result = await api.PUT('/api/admin/sessions/{id}', { params, body, bodySerializer: formData })
            if (!result.ok) return failure("La session n'a pas pu être enregistrée", result, session.id)
            changed(result.session)
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
            <dd>{session.hasFlyer ? <img src={flyerUrl(session)} alt={`Flyer de ${session.title}`} /> : 'Pas de flyer'}</dd>
            <dt>Événement RA</dt>
            <dd>
              {session.raEvent ? (
                linkOrMissing(session.raEvent)
              ) : (
                <>
                  {MISSING}{' '}
                  {open?.kind === 'raEvent' ? (
                    <RaEventPanel session={session} created={created} onSaved={changed} onCancel={() => openForm(null)} />
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
      {session.sets.length === 0 ? (
        <p className="admin-placeholder">Aucun set.</p>
      ) : (
        <SetsTable
          session={session}
          busy={busy}
          onStatus={changeSetStatus}
          onEdit={(set) => openForm({ kind: 'set', id: set.id })}
          onDelete={removeSet}
        />
      )}
      {open?.kind === 'set' && (
        <OpenSet
          // Afresh for each set.
          key={open.id ?? 'new'}
          session={session}
          set={session.sets.find((set) => set.id === open.id) ?? null}
          onClose={() => setOpen(null)}
          onChanged={changed}
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

// A set's links, by the names of their sites, each leading to it, then the application it comes from, if any, leading
// to its page, and named by when it was received for screen readers.
function SetLinks({ set }: { set: StudioSet }) {
  const links = [
    { name: 'SoundCloud', link: set.soundcloudTrack },
    { name: 'YouTube', link: set.youtubeVideo },
  ]
    .filter((link) => link.link)
    .map(({ name, link }) => (
      <a key={name} href={link!.url} target="_blank" rel="noreferrer">
        {name}
      </a>
    ))
  if (set.application) {
    const label = `Candidature ${receivedOn(set.application)}`
    links.push(
      <Link key="application" to={applicationPath(set.application)} aria-label={label}>
        Candidature
      </Link>,
    )
  }
  return links.map((link, i) => (
    <Fragment key={link.key}>
      {i > 0 && ' · '}
      {link}
    </Fragment>
  ))
}

// What's wrong with where a set is, a sentence each, when it isn't cancelled: that it doesn't fit in its session, then
// each set that it overlaps, in the order of the session's sets (see "Sets' places" in docs/design/server/sessions.md).
function setProblems(set: StudioSet, session: Session): string[] {
  if (set.status === 'cancelled') return []
  const overlapping = session.sets.filter((other) => set.overlappingSets.includes(other.id)).map((other) => `Chevauche ${setInSentence(other)}.`)
  if (set.fitsInSession) return overlapping
  const where = set.offsetMinutes === null ? 'Dure plus longtemps que' : set.offsetMinutes >= session.durationMinutes ? 'Commence après' : 'Finit après'
  return [`${where} la session.`, ...overlapping]
}

// The mark after a set's times, when its place is wrong, saying why in its tooltip.
function ProblemsMark({ problems }: { problems: string[] }) {
  return (
    problems.length > 0 && (
      <>
        {' '}
        {/* With U+FE0E, so that phones don't draw it as a colored emoji. */}
        <Button className="admin-warning" aria-label="avertissement" tip={problems}>
          {'\u26a0\ufe0e'}
        </Button>
      </>
    )
  )
}

// A session's sets, each with its status as buttons that change it, a button that opens its form, and one that deletes it.
// The sets of a cancelled session can't be un-cancelled. Those whose place is wrong are marked, saying why.
function SetsTable({
  session,
  busy,
  onStatus,
  onEdit,
  onDelete,
}: {
  session: Session
  busy: boolean
  onStatus: (set: StudioSet, status: SessionStatus) => void
  onEdit: (set: StudioSet) => void
  onDelete: (set: StudioSet) => void
}) {
  return (
    <table className="admin-table admin-table-controls" aria-label="Sets">
      <thead>
        <tr>
          <th>Heure</th>
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
          <tr key={set.id} className={`admin-status-${set.status}`}>
            <td className="admin-day">
              {setHours(set)}
              <ProblemsMark problems={setProblems(set, session)} />
            </td>
            <td>{set.performers.length > 0 ? <Performers performers={set.performers} /> : MISSING}</td>
            <td>{describePerformanceTypes(set)}</td>
            <td>{genreNames(set.genres)}</td>
            <td>
              <SetLinks set={set} />
            </td>
            <td>
              <StatusButtons
                label={`Statut : ${setName(set)}`}
                statuses={STATUSES}
                labels={SET_STATUS_LABELS}
                status={set.status}
                disabled={busy}
                unavailable={(status) => (session.status === 'cancelled' && status !== 'cancelled' ? 'La session est annulée\u00a0: on ne peut pas rétablir ses sets.' : null)}
                onChange={(status) => onStatus(set, status)}
              />
            </td>
            <td>
              <button type="button" aria-label={`modifier : ${setName(set)}`} onClick={() => onEdit(set)}>
                modifier
              </button>{' '}
              <button type="button" data-delete={set.id} aria-label={`supprimer : ${setName(set)}`} disabled={busy} onClick={() => onDelete(set)}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// The form of a set of `session`, or of a new one when `set` is null, under its sets, with every artist to pick the
// performers from, loaded each time it opens, so that they're current, and nothing until then. When they can't be
// loaded, it says so. A set's form also says who added it and changed it.
function OpenSet({ session, set, onClose, onChanged }: { session: Session; set: StudioSet | null; onClose: () => void; onChanged: (session: Session) => void }) {
  const artists = useApi('/api/admin/artists')
  const applications = useApi('/api/admin/applications')
  const headingId = useId()
  if (artists.kind === 'loading' || applications.kind === 'loading') return null

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>{set ? setTitle(set) : 'Nouveau set'}</h3>
      {set && (
        <>
          <p className="admin-meta">{byWhom('Ajouté', set.createdBy, set.createdAt)}</p>
          {set.updatedBy && <p className="admin-meta">{byWhom('Modifié', set.updatedBy, set.updatedAt)}</p>}
          {set.statusUpdatedBy && <p className="admin-meta">{byWhom('Statut changé', set.statusUpdatedBy, set.statusUpdatedAt)}</p>}
        </>
      )}
      {artists.kind === 'error' && <ArtistsFailure message={artists.message} />}
      {applications.kind === 'error' && <ApplicationsFailure message={applications.message} />}
      <SetForm
        session={session}
        initial={set ? setFormValues(set, session) : newSetFormValues(session)}
        artists={artists.kind === 'loaded' ? artists.value.artists : null}
        applications={applications.kind === 'loaded' ? applications.value.applications : null}
        submitLabel={set ? 'enregistrer' : 'ajouter le set'}
        onCancel={onClose}
        onSubmit={async (fields) => {
          const result = set
            ? await api.PUT('/api/admin/sets/{id}', { params: { path: { id: set.id } }, body: fields })
            : await api.POST('/api/admin/sessions/{id}/sets', { params: { path: { id: session.id } }, body: fields })
          if (!result.ok) return failure(set ? "Le set n'a pas pu être enregistré" : "Le set n'a pas pu être ajouté", result, session.id)
          onChanged(result.session)
          return null
        }}
      />
    </section>
  )
}

// Events from the year 2000 on, the earliest the server takes, which are every one of Parking Radio's events (see "Time
// ranges" in docs/design/server/events.md).
const EVERY_EVENT_FROM = '2000-01-01T00:00-05:00'

// The session form, with every collective to pick a takeover's from, loaded each time it opens, so that they're
// current, and nothing until then, and every event read from RA, which it doesn't wait for. When the collectives can't
// be loaded, it says so. A new session can start as a collective's takeover (`takeoverId`), if it's one of them.
function SessionFormWithChoices({
  takeoverId,
  initial,
  ...props
}: Omit<SessionFormProps, 'collectives' | 'applications' | 'events'> & { takeoverId?: string | null }) {
  const collectives = useApi('/api/admin/collectives')
  const applications = useApi('/api/admin/applications')
  // Asked for along with them, but not waited for.
  const events = useApi('/api/events', { params: { query: { from: EVERY_EVENT_FROM } } })
  if (collectives.kind === 'loading' || applications.kind === 'loading') return null
  const collectiveList = collectives.kind === 'loaded' ? collectives.value.collectives : null
  const takeover = collectiveList?.find((collective) => collective.id === takeoverId)
  return (
    <>
      {collectives.kind === 'error' && <CollectivesFailure message={collectives.message} />}
      {applications.kind === 'error' && <ApplicationsFailure message={applications.message} />}
      <SessionForm
        {...props}
        initial={takeover ? { ...initial, type: 'takeover', takeover: { id: takeover.id, name: takeover.name } } : initial}
        collectives={collectiveList}
        applications={applications.kind === 'loaded' ? applications.value.applications : null}
        events={events}
      />
    </>
  )
}

// Adding a session, as the takeover of the collective in the `takeover` query parameter, unless it isn't known.
export function NewSessionPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  return (
    <>
      <BackToSessions />
      <h1>Nouvelle session</h1>
      <SessionFormWithChoices
        takeoverId={searchParams.get('takeover')}
        initial={EMPTY_SESSION_FORM}
        submitLabel="ajouter la session"
        onSubmit={async (body) => {
          const result = await api.POST('/api/admin/sessions', { body, bodySerializer: formData })
          if (!result.ok) return failure("La session n'a pas pu être ajoutée", result)
          navigate(sessionPath(result.session))
          return null
        }}
      />
    </>
  )
}
