import { useId, useState } from 'react'
import { api } from '../../../api/client'
import { useApi } from '../../../api/use-api'

// "S'abonner": the admin's links to their calendars of the sessions and of the occupations, which their calendar app
// subscribes to (see docs/design/client/admin/calendrier.md, and docs/design/server/admin-calendars.md).

const CALENDARS = [
  {
    // What the calendar is of, which its path and its link's name for screen readers are made from.
    noun: 'sessions',
    name: 'Sessions',
    has: "les sessions datées depuis un an, et à venir, annoncées ou non, y compris les annulées, avec « [UNANNOUNCED] » et « [CANCELLED] » devant leur titre.",
  },
  {
    noun: 'occupations',
    name: 'Occupations',
    has: "les occupations des calendriers externes, nommées comme ici, et, aujourd'hui, un événement « [REFRESH ERROR] » suivi du nom de chaque calendrier externe dont la dernière lecture a échoué.",
  },
] as const

export function Subscribe() {
  const headingId = useId()
  const loaded = useApi('/api/admin/ics-subscription-token')
  // The token once the links were regenerated, which takes the place of the one loaded.
  const [replaced, setReplaced] = useState<string | null>(null)
  const [replacing, setReplacing] = useState<{ kind: 'idle' | 'sending' | 'done' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  const token = replaced ?? (loaded.kind === 'loaded' ? loaded.value.token : null)

  const replace = async () => {
    if (!window.confirm('Régénérer vos liens ? Les calendriers abonnés avec les liens actuels ne seront plus mis à jour.')) return
    setReplacing({ kind: 'sending' })
    const result = await api.POST('/api/admin/ics-subscription-token')
    if (!result.ok) return setReplacing({ kind: 'error', message: result.error })
    setReplaced(result.token)
    setReplacing({ kind: 'done' })
  }

  // Greyed out until the links are known, and while they're regenerated, keeping the focus (see "Controls that can't be
  // used" in docs/design/client/admin/layout.md).
  const unusable = token === null || replacing.kind === 'sending'
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>S'abonner</h2>
      <p>
        Ajoutez à votre application de calendrier ce qui prend le studio. Ces liens sont personnels&nbsp;: quiconque les a voit
        ces calendriers. Dans Google Agenda, ajoutez un lien avec «&nbsp;À partir de l'URL&nbsp;»&nbsp;: Google le relit à son
        rythme, jusqu'à un jour plus tard.
      </p>
      {loaded.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les liens n'ont pas pu être chargés&nbsp;: {loaded.message}
        </p>
      )}
      <ul className="admin-list">
        {CALENDARS.map((calendar) => (
          <li key={calendar.noun}>
            <p>
              <strong>{calendar.name}</strong>&nbsp;: {calendar.has}
            </p>
            {token !== null && (
              <p>
                <a href={`webcal://${window.location.host}/${calendar.noun}.ics?token=${token}`} aria-label={`s'abonner aux ${calendar.noun}`}>
                  s'abonner
                </a>
              </p>
            )}
          </li>
        ))}
      </ul>
      <p>
        <button type="button" aria-disabled={unusable || undefined} onClick={unusable ? undefined : replace}>
          régénérer les liens
        </button>
      </p>
      {replacing.kind === 'done' && (
        <p className="admin-notice" role="status">
          Liens régénérés&nbsp;: abonnez-vous avec les nouveaux liens, puis retirez les anciens calendriers de votre application.
        </p>
      )}
      {replacing.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les liens n'ont pas pu être régénérés&nbsp;: {replacing.message}
        </p>
      )}
    </section>
  )
}
