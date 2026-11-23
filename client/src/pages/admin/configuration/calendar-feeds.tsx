import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../../api/client'
import type { Schema } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { byWhom, dateTimeFormat } from '../describe'

// The calendar feeds that the studio's occupations are read from, in the configuration section (see
// docs/design/client/admin/configuration.md).

type Feed = Schema<'CalendarFeed'>
type FeedFields = Pick<Feed, 'name' | 'link' | 'privateTitles'>

// The server's limit (see server/src/calendar/fields.ts), which decides. The link has none here, since a link that's
// pasted would be cut short without a word: the server says when it's too long.
const NAME_MAX_LENGTH = 100

export function CalendarFeeds() {
  const loaded = useApi('/api/admin/calendar/feeds')

  return (
    <>
      <p>
        Ce qui occupe le studio en dehors des sessions est lu dans des calendriers externes, au format iCal, chaque occupation
        sous le nom de son calendrier. Par exemple, le lien du Google Agenda de l'équipe est son «&nbsp;adresse secrète au
        format iCal&nbsp;», dans ses paramètres.
      </p>
      <p>
        Le serveur lit ces calendriers toutes les 15 minutes. Leurs liens sont secrets, puisque quiconque a le lien d'un
        calendrier peut le lire&nbsp;: ils ne sont jamais donnés aux applications connectées.
      </p>
      <p>
        Avec <b>titres privés</b>, le serveur ne garde jamais les titres des événements du calendrier, qui n'apparaissent
        que sous son nom&nbsp;: par exemple pour un calendrier des séjours d'invités, qui peut donner leurs noms.
      </p>
      {loaded.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les calendriers externes n'ont pas pu être chargés&nbsp;: {loaded.message}
        </p>
      )}
      {loaded.kind === 'loaded' && <Feeds loaded={loaded.value.feeds} />}
    </>
  )
}

// The feeds, as they're added, changed and removed, and the form that adds one.
function Feeds({ loaded }: { loaded: Feed[] }) {
  const [feeds, setFeeds] = useState(loaded)

  return (
    <>
      {feeds.length === 0 ? (
        <p className="admin-placeholder">Aucun calendrier externe pour le moment.</p>
      ) : (
        <ul className="admin-list">
          {feeds.map((feed) => (
            <FeedItem
              key={feed.id}
              feed={feed}
              onChanged={(changed) => setFeeds((current) => current.map((other) => (other.id === changed.id ? changed : other)))}
              onRemoved={() => setFeeds((current) => current.filter(({ id }) => id !== feed.id))}
            />
          ))}
        </ul>
      )}
      <FeedForm
        initial={{ name: '', link: '', privateTitles: true }}
        action="ajouter"
        failure="Le calendrier n'a pas pu être ajouté"
        save={(fields) => api.POST('/api/admin/calendar/feeds', { body: fields })}
        onSaved={(feed) => setFeeds((current) => [...current, feed])}
      />
    </>
  )
}

// What's changed in `fields`, the form's, from `feed`, and only that, so that a form opened before another admin changed
// the feed doesn't undo their changes, e.g. make its titles stop being private. The server trims the name and the link.
function changesOf(feed: Feed, fields: FeedFields): Partial<FeedFields> {
  const changes: Partial<FeedFields> = {}
  if (fields.name.trim() !== feed.name) changes.name = fields.name
  if (fields.link.trim() !== feed.link) changes.link = fields.link
  if (fields.privateTitles !== feed.privateTitles) changes.privateTitles = fields.privateTitles
  return changes
}

function FeedItem({ feed, onChanged, onRemoved }: { feed: Feed; onChanged: (feed: Feed) => void; onRemoved: () => void }) {
  const [editing, setEditing] = useState(false)
  // Whether the form was closed, which then gives the focus back to "modifier".
  const closed = useRef(false)
  const edit = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!editing && closed.current) edit.current?.focus()
    closed.current = false
  }, [editing])
  const close = () => {
    closed.current = true
    setEditing(false)
  }
  const [busy, setBusy] = useState(false)
  // Why it couldn't be removed, if it couldn't.
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    if (!window.confirm(`Retirer le calendrier «\u00a0${feed.name}\u00a0» ?`)) return
    setBusy(true)
    const result = await api.DELETE('/api/admin/calendar/feeds/{id}', { params: { path: { id: feed.id } } })
    setBusy(false)
    if (result.ok) onRemoved()
    else setError(result.error)
  }

  if (editing) {
    return (
      <li>
        <FeedForm
          initial={feed}
          action="enregistrer"
          failure="Le calendrier n'a pas pu être enregistré"
          save={async (fields) => {
            const changes = changesOf(feed, fields)
            if (Object.keys(changes).length === 0) return { ok: true, feed }
            return api.PATCH('/api/admin/calendar/feeds/{id}', { params: { path: { id: feed.id } }, body: changes })
          }}
          onSaved={(changed) => {
            close()
            onChanged(changed)
          }}
          onCancel={close}
        />
      </li>
    )
  }

  return (
    <li>
      <p>
        <b>{feed.name}</b>
        {feed.privateTitles && ' (titres privés)'}{' '}
        <button ref={edit} type="button" disabled={busy} onClick={() => setEditing(true)}>
          modifier
        </button>{' '}
        <button type="button" disabled={busy} onClick={remove}>
          retirer
        </button>
      </p>
      <p className="admin-feed-link">{feed.link}</p>
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

type Saved = { ok: true; feed: Feed } | { ok: false; error: string }

// The form that adds a feed, cleared once it's added, or changes one, which closes once it's changed, and whose name gets
// the focus when it opens.
function FeedForm({
  initial,
  action,
  failure,
  save,
  onSaved,
  onCancel,
}: {
  initial: FeedFields
  action: string
  failure: string
  save: (fields: FeedFields) => Promise<Saved>
  onSaved: (feed: Feed) => void
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [link, setLink] = useState(initial.link)
  const [privateTitles, setPrivateTitles] = useState(initial.privateTitles)
  // While the server saves the feed, which can take up to 30 seconds, or longer while it goes through other calendars,
  // when it reads a new link.
  const [busy, setBusy] = useState(false)
  // Why the feed couldn't be saved, if it couldn't.
  const [error, setError] = useState<string | null>(null)
  const complete = name.trim() !== '' && link.trim() !== ''
  const reads = link.trim() !== initial.link

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!complete || busy) return
    setBusy(true)
    setError(null)
    const result = await save({ name, link, privateTitles })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setName(initial.name)
    setLink(initial.link)
    setPrivateTitles(initial.privateTitles)
    onSaved(result.feed)
  }

  return (
    <>
      <form className="admin-form" onSubmit={submit}>
        <label>
          Nom
          <input autoFocus={onCancel !== undefined} value={name} maxLength={NAME_MAX_LENGTH} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Lien
          <input value={link} autoComplete="off" spellCheck={false} onChange={(event) => setLink(event.target.value)} required />
        </label>
        <div className="admin-choices">
          <label>
            <input type="checkbox" checked={privateTitles} onChange={(event) => setPrivateTitles(event.target.checked)} />
            Titres privés
          </label>
        </div>
        <div className="admin-row">
          <button type="submit" disabled={busy || !complete}>
            {action}
          </button>
          {onCancel && (
            <button type="button" disabled={busy} onClick={onCancel}>
              annuler
            </button>
          )}
          {busy && reads && <span className="admin-meta">Lecture du calendrier…</span>}
        </div>
      </form>
      {error && (
        <p className="admin-error" role="alert">
          {failure}&nbsp;: {error}
        </p>
      )}
    </>
  )
}
