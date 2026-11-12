import { Fragment, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Loaded } from '../../api/use-api'
import { APPLICATION_STATUSES } from '../../application-fields'
import type { Application, ApplicationStatus } from '../../application-fields'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { AdminTable } from './admin-table'
import { ApplicationForm } from './application-form'
import {
  KIND_LABELS,
  MISSING,
  STATUS_LABELS,
  STATUS_PLURALS,
  applicationOwner,
  artistEntry,
  byWhom,
  collectiveEntry,
  collectiveGenreNames,
  comparePlaces,
  dateFormat,
  describePerformanceTypes,
  entryPath,
  formatDay,
  formatShortDay,
  genreNames,
  place,
} from './describe'
import type { Entry, EntryKind, Owner } from './describe'
import { ArtistsFailure, CollectivesFailure, MembersList } from './profile-details'
import { compareText, search, useSearchQuery, useSort, useStatusFilter } from './list'
import type { SortColumn, Sorting } from './list'
import { SearchField, SortHeader, StatusButtons, StatusFilters } from './list-controls'

// The applications section: every application, each one's page, where its status is changed and it's changed or
// deleted, and creating one by hand, e.g. to bring in one that came through the original Google Form.

// How many of an application's dates the list shows, before saying how many more there are.
const LISTED_DATES = 3

function BackToApplications() {
  return (
    <Link to="/admin/candidatures" className="admin-back">
      ← candidatures
    </Link>
  )
}

// Who applications are for, artists and collectives, by the address of their page, which tells them apart.
type Owners = Map<string, Entry>

// Without the `artists`, which couldn't be loaded, the collectives' genres are unknown.
function owners(artists: Artist[] | null, collectives: Collective[]): Owners {
  const byId = artists && new Map(artists.map((artist) => [artist.id, artist]))
  const entries = [...(artists ?? []).map(artistEntry), ...collectives.map((collective) => collectiveEntry(collective, byId))]
  return new Map(entries.map((entry) => [entryPath(entry.kind, entry.id), entry]))
}

function ownerOf(application: Application, owners: Owners): Entry | undefined {
  const { kind, id } = applicationOwner(application)
  return owners.get(entryPath(kind, id))
}

// What's shown in place of the name of who an application is for, when it isn't known.
const unknownOwner = (kind: EntryKind) => `${KIND_LABELS[kind]} inconnu`

// An application as it's named among others, e.g. "Candidature de Aurore, reçue le 28 mars 2026", since an artist can have
// several.
function applicationName(application: Application, owner: Entry | undefined): string {
  const name = owner?.name ?? unknownOwner(applicationOwner(application).kind)
  return `Candidature de ${name}, reçue le ${dateFormat.format(new Date(application.receivedAt))}`
}

// What the list of applications opens on.
const DEFAULT_STATUS: ApplicationStatus = 'new'
// Those still to go through, where the oldest come first, rather than the most recently received.
const OLDEST_FIRST: (ApplicationStatus | null)[] = [DEFAULT_STATUS, 'accepted']

// The columns the list of applications can be sorted by, where statuses are in the order applications usually go through
// them.
type ApplicationColumn = 'received' | 'artist' | 'city' | 'dates' | 'status'

function applicationColumns(owners: Owners, status: ApplicationStatus | null): Record<ApplicationColumn, SortColumn<Application>> {
  const name = (application: Application) => ownerOf(application, owners)?.name ?? ''
  // An unknown artist or collective has no city or country, like one whose place is left out.
  const placeOf = (application: Application) => ownerOf(application, owners) ?? { city: '', country: '' }
  return {
    received: { compare: (a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt), descendingFirst: !OLDEST_FIRST.includes(status) },
    artist: { compare: (a, b) => compareText(name(a), name(b)) },
    city: { compare: (a, b) => comparePlaces(placeOf(a), placeOf(b)) },
    // By the first day the artist would like to play.
    dates: { compare: (a, b) => a.dates[0].localeCompare(b.dates[0]) },
    status: { compare: (a, b) => APPLICATION_STATUSES.indexOf(a.status) - APPLICATION_STATUSES.indexOf(b.status) },
  }
}

// Applications, as listed in this section, or on an artist's or a collective's page, under the heading whose id is
// `labelledBy`, where `owners` is left out since they're all theirs, and so are the columns about them. The columns sort
// the list when there's `sorting`, and the statuses are dropdowns that change them when there's `changeStatus`.
export function ApplicationsTable({
  applications,
  owners,
  sorting,
  changeStatus,
  labelledBy,
}: {
  applications: Application[]
  owners?: Owners
  sorting?: Sorting<ApplicationColumn>
  changeStatus?: (application: Application, status: ApplicationStatus) => Promise<void>
  labelledBy?: string
}) {
  const header = (column: ApplicationColumn, label: string) =>
    sorting ? (
      <SortHeader column={column} sorting={sorting}>
        {label}
      </SortHeader>
    ) : (
      <th>{label}</th>
    )
  return (
    <AdminTable aria-labelledby={labelledBy}>
      <thead>
        <tr>
          {header('received', 'Reçue le')}
          {owners && (
            <>
              {header('artist', 'Artiste')}
              {header('city', 'Ville')}
              <th>Genres</th>
            </>
          )}
          {header('dates', 'Dates')}
          <th>Prestations</th>
          {header('status', 'Statut')}
        </tr>
      </thead>
      <tbody>
        {applications.map((application) => {
          const more = application.dates.length - LISTED_DATES
          // Unknown when the artists or the collectives couldn't be loaded, which leaves their place and genres blank
          // rather than left out, like a collective's genres when only the artists couldn't be.
          const owner = owners && ownerOf(application, owners)
          return (
            <tr key={application.id} className={`admin-status-${application.status}`}>
              <td>
                <Link to={`/admin/candidatures/${application.id}`}>{dateFormat.format(new Date(application.receivedAt))}</Link>
              </td>
              {owners && (
                <>
                  <td>
                    <OwnerName application={application} owner={owner} />
                  </td>
                  <td>{owner && place(owner)}</td>
                  <td>{owner?.genres && genreNames(owner.genres)}</td>
                </>
              )}
              <td>
                {application.dates.slice(0, LISTED_DATES).map((day, i) => (
                  <Fragment key={day}>
                    {i > 0 && ', '}
                    <span className="admin-day">{formatShortDay(day)}</span>
                  </Fragment>
                ))}
                {more > 0 && ` (+${more})`}
              </td>
              <td>{describePerformanceTypes(application)}</td>
              <td className="admin-status">
                {changeStatus ? (
                  <StatusSelect
                    label={`Statut : ${applicationName(application, owner)}`}
                    status={application.status}
                    onChange={(status) => changeStatus(application, status)}
                  />
                ) : (
                  STATUS_LABELS[application.status]
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </AdminTable>
  )
}

// An application's status, as a dropdown that changes it, which shows the one picked and can't be used while it's saved.
function StatusSelect({ label, status, onChange }: { label: string; status: ApplicationStatus; onChange: (status: ApplicationStatus) => Promise<void> }) {
  const [saving, setSaving] = useState<ApplicationStatus | null>(null)
  return (
    <select
      className="admin-status-select"
      aria-label={label}
      value={saving ?? status}
      disabled={saving !== null}
      onChange={async (event) => {
        const picked = event.target.value as ApplicationStatus
        setSaving(picked)
        await onChange(picked)
        setSaving(null)
      }}
    >
      {APPLICATION_STATUSES.map((each) => (
        <option key={each} value={each}>
          {STATUS_LABELS[each]}
        </option>
      ))}
    </select>
  )
}

// Who an application is for, linking to their page, followed by "(collectif)" for a collective.
function OwnerName({ application, owner }: { application: Application; owner: Entry | undefined }) {
  if (!owner) {
    const { kind, id } = applicationOwner(application)
    return <Link to={entryPath(kind, id)}>{unknownOwner(kind)}</Link>
  }
  return (
    <>
      <Link to={entryPath(owner.kind, owner.id)}>{owner.name}</Link>
      {owner.kind === 'collective' && ` (${KIND_LABELS.collective})`}
    </>
  )
}

// The applications of an artist or a collective, on their page, with a link to `newPath`, which creates another one.
export function OwnApplications({ applications, newPath }: { applications: Loaded<{ applications: Application[] }>; newPath: string }) {
  const headingId = useId()
  return (
    <>
      <h2 id={headingId}>Candidatures</h2>
      <div className="admin-toolbar">
        <Link to={newPath} className="admin-button">
          nouvelle candidature
        </Link>
      </div>
      {applications.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les candidatures n'ont pas pu être chargées&nbsp;: {applications.message}
        </p>
      )}
      {applications.kind === 'loaded' &&
        (applications.value.applications.length === 0 ? (
          <p className="admin-placeholder">Aucune candidature.</p>
        ) : (
          <ApplicationsTable applications={applications.value.applications} labelledBy={headingId} />
        ))}
    </>
  )
}

// Every application.
export function ApplicationsPage() {
  const { query, setQuery } = useSearchQuery()
  return (
    <>
      <h1>Candidatures</h1>
      <div className="admin-toolbar">
        <Link to="/admin/candidatures/nouvelle" className="admin-button">
          nouvelle candidature
        </Link>
        <SearchField query={query} onChange={setQuery} />
      </div>
      <ApplicationsList query={query} />
    </>
  )
}

// What an application is searched by, besides its artist or collective (see `Entry`): its performance types, details,
// and the days the artist would like to play, written out, e.g. "jeudi 10 décembre 2026", so that "décembre" or "jeudi"
// finds them.
function applicationSearchFields(application: Application): string[] {
  return [describePerformanceTypes(application), application.details, ...application.dates.map(formatDay)].filter(Boolean)
}

// The applications with the status in the `status` query parameter, the default view without one, or every application,
// or those of them that `query` finds. The status's buttons count the applications the search finds.
function ApplicationsList({ query }: { query: string }) {
  const applications = useApi('/api/admin/applications')
  const artists = useApi('/api/admin/artists')
  const collectives = useApi('/api/admin/collectives')
  // Without the artists or the collectives, the applications are still listed, without their names, places and genres.
  const byKey = owners(
    artists.kind === 'loaded' ? artists.value.artists : null,
    collectives.kind === 'loaded' ? collectives.value.collectives : [],
  )
  const [status, setStatus] = useStatusFilter(APPLICATION_STATUSES, DEFAULT_STATUS)
  const sorting = useSort(applicationColumns(byKey, status), 'received')
  // The applications as the changes of their status left them, which replace the ones loaded.
  const [changed, setChanged] = useState<Record<string, Application>>({})
  const [statusError, setStatusError] = useState<string | null>(null)

  if (applications.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        Les candidatures n'ont pas pu être chargées&nbsp;: {applications.message}
      </p>
    )
  }
  if (applications.kind === 'loading' || artists.kind === 'loading' || collectives.kind === 'loading') return null

  const all = applications.value.applications.map((application) => changed[application.id] ?? application)
  const found = search(all, query, (application) => [...(ownerOf(application, byKey)?.searchFields ?? []), ...applicationSearchFields(application)])
  const withStatus = (applications: Application[]) => (status ? applications.filter((application) => application.status === status) : applications)
  const listed = sorting.sorted(withStatus(found))

  const changeStatus = async (application: Application, status: ApplicationStatus) => {
    setStatusError(null)
    const result = await api.PUT('/api/admin/applications/{id}/status', { params: { path: { id: application.id } }, body: { status } })
    if (result.ok) setChanged((changed) => ({ ...changed, [application.id]: result.application }))
    else setStatusError(`Le statut de «\u00a0${applicationName(application, ownerOf(application, byKey))}\u00a0» n'a pas pu être changé : ${result.error}`)
  }

  return (
    <>
      <StatusFilters
        all="toutes"
        statuses={APPLICATION_STATUSES}
        labels={STATUS_PLURALS}
        status={status}
        count={(status) => (status ? found.filter((application) => application.status === status).length : found.length)}
        onChange={setStatus}
      />
      {artists.kind === 'error' && <ArtistsFailure message={artists.message} />}
      {collectives.kind === 'error' && <CollectivesFailure message={collectives.message} />}
      {statusError && (
        <p className="admin-error" role="alert">
          {statusError}
        </p>
      )}
      {listed.length === 0 ? (
        <p className="admin-placeholder">
          {all.length === 0
            ? 'Aucune candidature.'
            : withStatus(all).length === 0
              ? 'Aucune candidature avec ce statut.'
              : 'Aucune candidature ne correspond à la recherche.'}
        </p>
      ) : (
        <ApplicationsTable applications={listed} owners={byKey} sorting={sorting} changeStatus={changeStatus} />
      )}
    </>
  )
}

// An application's page. It starts afresh for each application, rather than showing the last one while the next one
// loads.
export function ApplicationPage() {
  const { id } = useParams() as { id: string }
  return <ApplicationById key={id} id={id} />
}

function ApplicationById({ id }: { id: string }) {
  const loaded = useApi('/api/admin/applications/{id}', { params: { path: { id } } })

  if (loaded.kind === 'loading') return <BackToApplications />
  if (loaded.kind === 'error') {
    return (
      <>
        <BackToApplications />
        <p className="admin-error" role="alert">
          La candidature n'a pas pu être chargée&nbsp;: {loaded.message}
        </p>
      </>
    )
  }
  const application = loaded.value.application
  const owner = applicationOwner(application)
  return owner.kind === 'collective' ? (
    <CollectiveApplication loaded={application} collectiveId={owner.id} />
  ) : (
    <ArtistApplication loaded={application} artistId={owner.id} />
  )
}

// An artist's application, with who the artist is.
function ArtistApplication({ loaded, artistId }: { loaded: Application; artistId: string }) {
  const artist = useApi('/api/admin/artists/{id}', { params: { path: { id: artistId } } })
  return (
    <LoadedApplication
      loaded={loaded}
      name={artist.kind === 'loaded' ? artist.value.artist.name : null}
      stays="L'artiste reste."
      owner={
        <>
          <h2>Artiste</h2>
          {artist.kind === 'error' && (
            <p className="admin-error" role="alert">
              L'artiste n'a pas pu être chargé&nbsp;: {artist.message}
            </p>
          )}
          {artist.kind === 'loaded' && <ArtistSummary artist={artist.value.artist} />}
        </>
      }
    />
  )
}

// A collective's application, with what the collective is, and its artists, for its genres.
function CollectiveApplication({ loaded, collectiveId }: { loaded: Application; collectiveId: string }) {
  const collective = useApi('/api/admin/collectives/{id}', { params: { path: { id: collectiveId } } })
  const members = useApi('/api/admin/artists', { params: { query: { collective: collectiveId } } })
  return (
    <LoadedApplication
      loaded={loaded}
      name={collective.kind === 'loaded' ? collective.value.collective.name : null}
      stays="Le collectif reste."
      owner={
        <>
          <h2>Collectif</h2>
          {collective.kind === 'error' && (
            <p className="admin-error" role="alert">
              Le collectif n'a pas pu être chargé&nbsp;: {collective.message}
            </p>
          )}
          {members.kind === 'error' && <ArtistsFailure message={members.message} />}
          {collective.kind === 'loaded' && members.kind !== 'loading' && (
            <CollectiveSummary collective={collective.value.collective} members={members.kind === 'loaded' ? members.value.artists : null} />
          )}
        </>
      }
    />
  )
}

// An application, with `owner`, the section about who it's for, whose `name` is null until it's known, and who `stays` once
// it's deleted.
function LoadedApplication({ loaded, name, owner, stays }: { loaded: Application; name: string | null; owner: ReactNode; stays: string }) {
  // The application as the last change left it, which replaces the one loaded.
  const [application, setApplication] = useState(loaded)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const params = { path: { id: application.id } }
  const title = <h1>{name ? `Candidature de ${name}` : 'Candidature'}</h1>

  if (editing) {
    return (
      <>
        <BackToApplications />
        {title}
        <ApplicationForm
          application={application}
          submitLabel="enregistrer"
          onCancel={() => setEditing(false)}
          onSubmit={async (fields) => {
            const result = await api.PUT('/api/admin/applications/{id}', { params, body: fields })
            if (!result.ok) return `La candidature n'a pas pu être enregistrée : ${result.error}`
            setApplication(result.application)
            setEditing(false)
            return null
          }}
        />
      </>
    )
  }

  const changeStatus = async (status: ApplicationStatus) => {
    setBusy(true)
    setError(null)
    const result = await api.PUT('/api/admin/applications/{id}/status', { params, body: { status } })
    setBusy(false)
    if (result.ok) setApplication(result.application)
    else setError(`Le statut n'a pas pu être changé : ${result.error}`)
  }

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement cette candidature${name ? ` de ${name}` : ''} ?`)) return
    setBusy(true)
    setError(null)
    const result = await api.DELETE('/api/admin/applications/{id}', { params })
    if (result.ok) {
      navigate('/admin/candidatures')
    } else {
      setBusy(false)
      setError(`La candidature n'a pas pu être supprimée : ${result.error}`)
    }
  }

  return (
    <>
      <BackToApplications />
      {title}
      {/* Unless it was received the day it was created, e.g. if it was sent through the form. */}
      {dateFormat.format(new Date(application.receivedAt)) !== dateFormat.format(new Date(application.createdAt)) && (
        <p className="admin-meta">Reçue le {dateFormat.format(new Date(application.receivedAt))}.</p>
      )}
      <p className="admin-meta">
        {byWhom('Créée', application.createdBy, application.createdAt) ??
          `Envoyée par le formulaire «\u00a0appliquer\u00a0» le ${dateFormat.format(new Date(application.createdAt))}.`}
      </p>
      {application.updatedBy && <p className="admin-meta">{byWhom('Modifiée', application.updatedBy, application.updatedAt)}</p>}

      <h2>Statut</h2>
      <StatusButtons statuses={APPLICATION_STATUSES} labels={STATUS_LABELS} status={application.status} disabled={busy} onChange={changeStatus} />
      {application.statusUpdatedBy && <p className="admin-meta">{byWhom('Changé', application.statusUpdatedBy, application.statusUpdatedAt)}</p>}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}

      {owner}

      <h2>Candidature</h2>
      <div className="admin-toolbar">
        <button type="button" onClick={() => setEditing(true)}>
          modifier
        </button>
      </div>
      <dl className="admin-record">
        <dt>Dates souhaitées</dt>
        <dd>
          <ul>
            {application.dates.map((date) => (
              <li key={date}>{formatDay(date)}</li>
            ))}
          </ul>
        </dd>
        <dt>Plages horaires</dt>
        <dd>
          {application.timeSlots.length === 0
            ? 'à toute heure'
            : application.timeSlots.map(({ start, end }) => `${start} à ${end}`).join(', ')}
        </dd>
        <dt>Type de prestation</dt>
        <dd>{describePerformanceTypes(application) || '—'}</dd>
        <dt>Questions ou détails</dt>
        <dd className="admin-text">{application.details || '—'}</dd>
      </dl>

      <h2>Supprimer</h2>
      <p>La candidature sera supprimée pour de bon. {stays}</p>
      <button type="button" onClick={remove} disabled={busy}>
        supprimer la candidature
      </button>
    </>
  )
}

// Who the artist is and how to reach them. Everything else is on their page.
function ArtistSummary({ artist }: { artist: Artist }) {
  return (
    <dl className="admin-record">
      <dt>Nom</dt>
      <dd>
        <Link to={`/admin/artistes/${artist.id}`}>{artist.name}</Link> ({KIND_LABELS.artist})
      </dd>
      <dt>Ville</dt>
      <dd>{place(artist)}</dd>
      <dt>Genres</dt>
      <dd>{genreNames(artist.genres)}</dd>
      <dt>Adresse e-mail</dt>
      <dd>{artist.email ? <a href={`mailto:${artist.email}`}>{artist.email}</a> : MISSING}</dd>
      <dt>Téléphone</dt>
      <dd>{artist.phone ? <a href={`tel:${artist.phone}`}>{artist.phone}</a> : MISSING}</dd>
    </dl>
  )
}

// Who a collective is, its artists, with their genres, unless the `members` couldn't be loaded, which leaves them blank,
// and how to reach its contact. Everything else is on its page.
function CollectiveSummary({ collective, members }: { collective: Collective; members: Artist[] | null }) {
  return (
    <dl className="admin-record">
      <dt>Nom</dt>
      <dd>
        <Link to={entryPath('collective', collective.id)}>{collective.name}</Link> ({KIND_LABELS.collective})
      </dd>
      <dt>Ville</dt>
      <dd>{place(collective)}</dd>
      <dt>Genres de ses artistes</dt>
      <dd>{collectiveGenreNames(collective, members)}</dd>
      <dt>Artistes du collectif</dt>
      <dd>
        <MembersList members={collective.members} />
      </dd>
      <dt>Adresse e-mail du contact</dt>
      <dd>{collective.email ? <a href={`mailto:${collective.email}`}>{collective.email}</a> : MISSING}</dd>
      <dt>Téléphone du contact</dt>
      <dd>{collective.phone ? <a href={`tel:${collective.phone}`}>{collective.phone}</a> : MISSING}</dd>
    </dl>
  )
}

// Creating an application, for the artist in the `artist` query parameter, or the collective in `collective`, at first,
// if any.
export function NewApplicationPage() {
  const artists = useApi('/api/admin/artists')
  const collectives = useApi('/api/admin/collectives')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialArtist = searchParams.get('artist')
  const initialCollective = searchParams.get('collective')

  let content
  if (artists.kind === 'loading' || collectives.kind === 'loading') {
    content = null
  } else if (artists.kind === 'error' || collectives.kind === 'error') {
    content = (
      <>
        {artists.kind === 'error' && <ArtistsFailure message={artists.message} />}
        {collectives.kind === 'error' && <CollectivesFailure message={collectives.message} />}
      </>
    )
  } else if (artists.value.artists.length === 0 && collectives.value.collectives.length === 0) {
    content = (
      <p className="admin-placeholder">
        Une candidature est celle d'un artiste ou d'un collectif&nbsp;: ajoutez d'abord{' '}
        <Link to="/admin/artistes/nouveau">l'artiste</Link> ou <Link to="/admin/artistes/collectifs/nouveau">le collectif</Link>.
      </p>
    )
  } else {
    const initial: Owner | null =
      initialArtist !== null ? { kind: 'artist', id: initialArtist } : initialCollective !== null ? { kind: 'collective', id: initialCollective } : null
    content = (
      <ApplicationForm
        owners={{ artists: artists.value.artists, collectives: collectives.value.collectives, initial }}
        submitLabel="créer la candidature"
        onSubmit={async (fields, owner) => {
          const body = { ...fields, ...(owner.kind === 'artist' ? { artistId: owner.id } : { collectiveId: owner.id }) }
          const result = await api.POST('/api/admin/applications', { body })
          if (!result.ok) return `La candidature n'a pas pu être créée : ${result.error}`
          navigate(`/admin/candidatures/${result.application.id}`)
          return null
        }}
      />
    )
  }

  return (
    <>
      <BackToApplications />
      <h1>Nouvelle candidature</h1>
      {content}
    </>
  )
}
