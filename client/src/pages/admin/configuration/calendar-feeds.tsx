import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../../api/client'
import type { Schema } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { FEED_KIND_LABELS, byWhom, dateTimeFormat } from '../describe'

// The calendar feeds that the studio's occupations and quiet time are read from, in the configuration section (see
// docs/design/client/admin/configuration.md).

type Feed = Schema<'CalendarFeed'>
type FeedKind = Schema<'FeedKind'>

// The server's limit (see server/src/calendar/fields.ts), which decides. The link has none here, since a link that's
// pasted would be cut short without a word: the server says when it's too long.
const NAME_MAX_LENGTH = 100

export function CalendarFeeds() {
  const loaded = useApi('/api/admin/calendar/feeds')

  return (
    <>
      <p>Ce qui occupe le studio en dehors des sessions est lu dans des calendriers externes, au format iCal&nbsp;:</p>
      <ul>
        <li>
          <b>{FEED_KIND_LABELS.occupation}</b>&nbsp;: tout ce qui prend le studio en dehors des sessions, par exemple
          d'après le Google Agenda de l'équipe, dont le lien est son «&nbsp;adresse secrète au format iCal&nbsp;», dans ses
          paramètres.
        </li>
        <li>
          <b>{FEED_KIND_LABELS['quiet-time']}</b>&nbsp;: quand des invités séjournent au studio, donc sans session ni bruit,
          d'après un calendrier privé de leurs séjours.
        </li>
      </ul>
      <p>Le serveur lit ces calendriers toutes les 15 minutes. Leurs liens sont secrets&nbsp;: ils ne sont plus jamais montrés une fois ajoutés.</p>
      {loaded.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les calendriers externes n'ont pas pu être chargés&nbsp;: {loaded.message}
        </p>
      )}
      {loaded.kind === 'loaded' && <Feeds loaded={loaded.value.feeds} />}
    </>
  )
}

// The feeds, as they're added and removed, and the form that adds one.
function Feeds({ loaded }: { loaded: Feed[] }) {
  const [feeds, setFeeds] = useState(loaded)

  return (
    <>
      {feeds.length === 0 ? (
        <p className="admin-placeholder">Aucun calendrier externe pour le moment.</p>
      ) : (
        <ul className="admin-list">
          {feeds.map((feed) => (
            <FeedItem key={feed.id} feed={feed} onRemoved={() => setFeeds((current) => current.filter(({ id }) => id !== feed.id))} />
          ))}
        </ul>
      )}
      <AddFeed onAdded={(feed) => setFeeds((current) => [...current, feed])} />
    </>
  )
}

function FeedItem({ feed, onRemoved }: { feed: Feed; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false)
  // Why it couldn't be removed, if it couldn't.
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    if (!window.confirm(`Retirer le calendrier «\u00a0${feed.name}\u00a0» ? Pour l'ajouter à nouveau, il faudra son lien.`)) return
    setBusy(true)
    const result = await api.DELETE('/api/admin/calendar/feeds/{id}', { params: { path: { id: feed.id } } })
    setBusy(false)
    if (result.ok) onRemoved()
    else setError(result.error)
  }

  return (
    <li>
      <p>
        <b>{feed.name}</b> ({FEED_KIND_LABELS[feed.kind]}){' '}
        <button type="button" disabled={busy} onClick={remove}>
          retirer
        </button>
      </p>
      <p className="admin-meta">
        {byWhom('Ajouté', feed.createdBy, feed.createdAt)} {feed.readAt ? `Lu le ${dateTimeFormat.format(new Date(feed.readAt))}.` : 'Pas encore lu.'}
      </p>
      {feed.error && <p className="admin-error">La dernière lecture a échoué&nbsp;: {feed.error}</p>}
      {error && (
        <p className="admin-error" role="alert">
          Le calendrier n'a pas pu être retiré&nbsp;: {error}
        </p>
      )}
    </li>
  )
}

function AddFeed({ onAdded }: { onAdded: (feed: Feed) => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<FeedKind | null>(null)
  const [link, setLink] = useState('')
  // While the server reads the link, which can take up to 30 seconds, or longer while it goes through other calendars.
  const [busy, setBusy] = useState(false)
  // Why the feed couldn't be added, if it couldn't.
  const [error, setError] = useState<string | null>(null)
  const complete = name.trim() !== '' && kind !== null && link.trim() !== ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!complete || busy) return
    setBusy(true)
    setError(null)
    const result = await api.POST('/api/admin/calendar/feeds', { body: { name, kind, link } })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setName('')
    setKind(null)
    setLink('')
    onAdded(result.feed)
  }

  return (
    <>
      <form className="admin-form" onSubmit={submit}>
        <label>
          Nom
          <input value={name} maxLength={NAME_MAX_LENGTH} onChange={(event) => setName(event.target.value)} required />
        </label>
        <fieldset>
          <legend>Type</legend>
          <div className="admin-choices">
            {(Object.keys(FEED_KIND_LABELS) as FeedKind[]).map((option) => (
              <label key={option}>
                <input type="radio" name="kind" checked={kind === option} onChange={() => setKind(option)} required />
                {FEED_KIND_LABELS[option]}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Lien
          <input
            type="password"
            className="admin-secret"
            value={link}
            autoComplete="off"
            onChange={(event) => setLink(event.target.value)}
            required
          />
        </label>
        <div className="admin-row">
          <button type="submit" disabled={busy || !complete}>
            ajouter
          </button>
          {busy && <span className="admin-meta">Lecture du calendrier…</span>}
        </div>
      </form>
      {error && (
        <p className="admin-error" role="alert">
          Le calendrier n'a pas pu être ajouté&nbsp;: {error}
        </p>
      )}
    </>
  )
}
