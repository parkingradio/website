import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { APPLICATION_STATUSES } from 'shared/applications'
import type {
  Application,
  ApplicationResponse,
  ApplicationStatus,
  ApplicationStatusRequest,
  ApplicationsResponse,
  CreateApplicationRequest,
  DeleteApplicationResponse,
  UpdateApplicationRequest,
} from 'shared/applications'
import type { Artist, ArtistResponse, ArtistsResponse } from 'shared/artists'
import { deleteJson, postJson, putJson } from '../../api'
import { ApplicationForm } from './application-form'
import { KIND_LABELS, STATUS_LABELS, byWhom, dateFormat, describePrestations, formatDay, formatShortDay, place } from './describe'
import { Recipients } from './recipients'
import { useApi } from './use-api'

// The applications section: every application, each one's page, where it's accepted or rejected, changed or deleted,
// and creating one by hand, e.g. to bring in an application that came through the Google Form.

// How many of an application's dates the list shows, before saying how many more there are.
const LISTED_DATES = 3

function BackToApplications() {
  return (
    <Link to="/admin/candidatures" className="admin-back">
      ← toutes les candidatures
    </Link>
  )
}

// Applications, as listed in this section, or on an artist's page, where `artists` is left out since they're all theirs.
export function ApplicationsTable({ applications, artists }: { applications: Application[]; artists?: Map<string, Artist> }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Reçue le</th>
          {artists && <th>Artiste</th>}
          <th>Dates</th>
          <th>Prestations</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody>
        {applications.map((application) => {
          const more = application.dates.length - LISTED_DATES
          return (
            <tr key={application.id}>
              <td>
                <Link to={`/admin/candidatures/${application.id}`}>{dateFormat.format(new Date(application.createdAt))}</Link>
              </td>
              {artists && (
                <td>
                  <Link to={`/admin/artistes/${application.artistId}`}>{artists.get(application.artistId)?.name ?? 'artiste inconnu'}</Link>
                </td>
              )}
              <td>
                {application.dates.slice(0, LISTED_DATES).map(formatShortDay).join(', ')}
                {more > 0 && ` (+${more})`}
              </td>
              <td>{describePrestations(application)}</td>
              <td className={`admin-status admin-status-${application.status}`}>{STATUS_LABELS[application.status]}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Every application, and who the ones artists send are emailed to.
export function ApplicationsPage() {
  return (
    <>
      <h1>Candidatures</h1>
      <div className="admin-toolbar">
        <Link to="/admin/candidatures/nouvelle" className="admin-button">
          nouvelle candidature
        </Link>
      </div>
      <ApplicationsList />

      <h2>Envoi par e-mail</h2>
      <Recipients />
    </>
  )
}

// Every application, newest first, or only those with the status in the `statut` query parameter.
function ApplicationsList() {
  const applications = useApi<ApplicationsResponse>('/api/admin/applications')
  const artists = useApi<ArtistsResponse>('/api/admin/artists')
  const [searchParams, setSearchParams] = useSearchParams()
  const status = APPLICATION_STATUSES.find((status) => status === searchParams.get('statut')) ?? null

  if (applications.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        Les candidatures n'ont pas pu être chargées&nbsp;: {applications.message}
      </p>
    )
  }
  if (applications.kind === 'loading' || artists.kind === 'loading') return null

  const all = applications.value.applications
  const listed = status ? all.filter((application) => application.status === status) : all
  // Without the artists, the applications are still listed, without their names.
  const byId = new Map(artists.kind === 'loaded' ? artists.value.artists.map((artist) => [artist.id, artist]) : [])
  const filters: { status: ApplicationStatus | null; label: string }[] = [
    { status: null, label: 'toutes' },
    ...APPLICATION_STATUSES.map((status) => ({ status, label: `${STATUS_LABELS[status]}s` })),
  ]

  return (
    <>
      <div className="admin-filters" role="group" aria-label="Statut">
        {filters.map((filter) => (
          <button
            key={filter.label}
            type="button"
            aria-pressed={status === filter.status}
            onClick={() => setSearchParams(filter.status ? { statut: filter.status } : {})}
          >
            {filter.label} ({filter.status ? all.filter((application) => application.status === filter.status).length : all.length})
          </button>
        ))}
      </div>
      {artists.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les artistes n'ont pas pu être chargés&nbsp;: {artists.message}
        </p>
      )}
      {listed.length === 0 ? (
        <p className="admin-placeholder">Aucune candidature.</p>
      ) : (
        <ApplicationsTable applications={listed} artists={byId} />
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
  const loaded = useApi<ApplicationResponse>(`/api/admin/applications/${encodeURIComponent(id)}`)

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
  return <LoadedApplication loaded={loaded.value.application} />
}

function LoadedApplication({ loaded }: { loaded: Application }) {
  const artist = useApi<ArtistResponse>(`/api/admin/artists/${loaded.artistId}`)
  // The application as the last change left it, which replaces the one loaded.
  const [application, setApplication] = useState(loaded)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const url = `/api/admin/applications/${application.id}`
  const name = artist.kind === 'loaded' ? artist.value.artist.name : null
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
            const result = await putJson<UpdateApplicationRequest, ApplicationResponse>(url, fields)
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
    const result = await putJson<ApplicationStatusRequest, ApplicationResponse>(`${url}/status`, { status })
    setBusy(false)
    if (result.ok) setApplication(result.application)
    else setError(`Le statut n'a pas pu être changé : ${result.error}`)
  }

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement cette candidature${name ? ` de ${name}` : ''} ?`)) return
    setBusy(true)
    setError(null)
    const result = await deleteJson<DeleteApplicationResponse>(url)
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
      <p className="admin-meta">
        {byWhom('Créée', application.createdBy, application.createdAt) ??
          `Envoyée par le formulaire «\u00a0appliquer\u00a0» le ${dateFormat.format(new Date(application.createdAt))}.`}
      </p>
      {application.updatedBy && <p className="admin-meta">{byWhom('Modifiée', application.updatedBy, application.updatedAt)}</p>}

      <h2>Statut</h2>
      <div className="admin-filters" role="group" aria-label="Statut">
        {APPLICATION_STATUSES.map((status) => (
          <button key={status} type="button" aria-pressed={application.status === status} disabled={busy} onClick={() => changeStatus(status)}>
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      {application.statusUpdatedBy && <p className="admin-meta">{byWhom('Changé', application.statusUpdatedBy, application.statusUpdatedAt)}</p>}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}

      <h2>Artiste</h2>
      {artist.kind === 'error' && (
        <p className="admin-error" role="alert">
          L'artiste n'a pas pu être chargé&nbsp;: {artist.message}
        </p>
      )}
      {artist.kind === 'loaded' && <ArtistSummary artist={artist.value.artist} />}

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
        <dd>{describePrestations(application) || '—'}</dd>
        <dt>Questions ou détails</dt>
        <dd className="admin-text">{application.details || '—'}</dd>
      </dl>

      <h2>Supprimer</h2>
      <p>La candidature sera supprimée pour de bon. L'artiste reste.</p>
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
        <Link to={`/admin/artistes/${artist.id}`}>{artist.name}</Link> ({KIND_LABELS[artist.kind]})
      </dd>
      <dt>Ville</dt>
      <dd>{place(artist)}</dd>
      <dt>Adresse e-mail</dt>
      <dd>
        <a href={`mailto:${artist.email}`}>{artist.email}</a>
      </dd>
      <dt>Téléphone</dt>
      <dd>
        <a href={`tel:${artist.phone}`}>{artist.phone}</a>
      </dd>
    </dl>
  )
}

// Creating an application, for the artist in the `artiste` query parameter at first, if any.
export function NewApplicationPage() {
  const artists = useApi<ArtistsResponse>('/api/admin/artists')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  let content
  if (artists.kind === 'loading') {
    content = null
  } else if (artists.kind === 'error') {
    content = (
      <p className="admin-error" role="alert">
        Les artistes n'ont pas pu être chargés&nbsp;: {artists.message}
      </p>
    )
  } else if (artists.value.artists.length === 0) {
    content = (
      <p className="admin-placeholder">
        Une candidature est celle d'un artiste&nbsp;: <Link to="/admin/artistes/nouveau">ajoutez d'abord l'artiste</Link>.
      </p>
    )
  } else {
    content = (
      <ApplicationForm
        artists={{ all: artists.value.artists, initial: searchParams.get('artiste') }}
        submitLabel="créer la candidature"
        onSubmit={async (fields, artistId) => {
          const result = await postJson<CreateApplicationRequest, ApplicationResponse>('/api/admin/applications', { ...fields, artistId })
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
