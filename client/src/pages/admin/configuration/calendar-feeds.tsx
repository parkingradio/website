import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from '../../../api/client'
import type { Schema } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { everyOne } from '../../../checks'
import { FEED_KIND_LABELS, byWhom, dateTimeFormat } from '../describe'

// The calendar feeds that the studio's occupations and holds are read from, in the configuration section (see
// docs/design/client/admin/configuration.md).

type Feed = Schema<'CalendarFeed'>
type FeedKind = Schema<'CalendarFeedKind'>
type FeedFields = Pick<Feed, 'name' | 'kind' | 'link'>
// What the form has, where no kind is picked at first when it adds a feed, so that it's always chosen.
type FormFields = Omit<FeedFields, 'kind'> & { kind: FeedKind | null }
// In the order the form offers them.
const FEED_KINDS = everyOne<FeedKind>()(['occupations', 'holds'])

// The server's limit (see server/src/calendar/fields.ts), which decides. The link has none here, since a link that's
// pasted would be cut short without a word: the server says when it's too long.
const NAME_MAX_LENGTH = 100

export function CalendarFeeds() {
  const loaded = useApi('/api/admin/calendar/feeds')

  return (
    <>
      <p>
        Ce qui occupe le studio en dehors des sessions est lu dans des calendriers externes, au format iCal, de type
        «&nbsp;Occupations&nbsp;», chaque occupation sous le nom de son calendrier. Le temps protégé pour les sessions est
        lu dans ceux de type «&nbsp;Plages protégées&nbsp;». Le serveur lit ces calendriers toutes les 15 minutes.
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

// The feeds, as they're added, changed and removed, in a table, one per row, and the form that adds one.
function Feeds({ loaded }: { loaded: Feed[] }) {
  const [feeds, setFeeds] = useState(loaded)

  return (
    <>
      {feeds.length === 0 ? (
        <p className="admin-placeholder">Aucun calendrier externe pour le moment.</p>
      ) : (
        <table className="admin-table admin-table-controls" aria-label="Calendriers externes">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Type</th>
              <th>Dernière lecture</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          {feeds.map((feed) => (
            <FeedRows
              key={feed.id}
              feed={feed}
              onChanged={(changed) => setFeeds((current) => current.map((other) => (other.id === changed.id ? changed : other)))}
              onRemoved={() => setFeeds((current) => current.filter(({ id }) => id !== feed.id))}
            />
          ))}
        </table>
      )}
      <FeedForm
        initial={{ name: '', kind: null, link: '' }}
        action="ajouter"
        failure="Le calendrier n'a pas pu être ajouté"
        save={(fields) => api.POST('/api/admin/calendar/feeds', { body: fields })}
        onSaved={(feed) => setFeeds((current) => [...current, feed])}
      />
    </>
  )
}

// What's changed in `fields`, the form's, from `feed`, and only that, so that a form opened before another admin changed
// the feed doesn't undo their changes, e.g. a new name, when only the link is changed here. The server trims the name and
// the link.
function changesOf(feed: Feed, fields: FeedFields): Partial<FeedFields> {
  const changes: Partial<FeedFields> = {}
  if (fields.name.trim() !== feed.name) changes.name = fields.name
  if (fields.kind !== feed.kind) changes.kind = fields.kind
  if (fields.link.trim() !== feed.link) changes.link = fields.link
  return changes
}

// A row across the table's four columns, e.g. the form that changes a feed. `headers` is the id of the header its cell
// is under, rather than the first column's.
function SpanRow({ headers, children }: { headers?: string; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={4} className="admin-table-span" headers={headers}>
        <div>{children}</div>
      </td>
    </tr>
  )
}

// A feed's rows, together: its row, or the form that changes it, then, under it, the line that says why its last read
// failed, or why it couldn't be removed, if either did.
function FeedRows({ feed, onChanged, onRemoved }: { feed: Feed; onChanged: (feed: Feed) => void; onRemoved: () => void }) {
  const nameId = useId()
  const [editing, setEditing] = useState(false)
  // Whether the form was closed, which then gives the focus back to "modifier", in a layout effect (see LoadedSession in
  // sessions.tsx), since the form also closes once the PATCH answers.
  const closed = useRef(false)
  const edit = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
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

  const failed = feed.error !== null

  return (
    <tbody>
      {editing ? (
        <SpanRow>
          <p className="admin-meta">{byWhom('Ajouté', feed.createdBy, feed.createdAt)}</p>
          {feed.updatedBy && <p className="admin-meta">{byWhom('Modifié', feed.updatedBy, feed.updatedAt)}</p>}
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
        </SpanRow>
      ) : (
        <tr>
          <th scope="row" id={nameId}>
            {feed.name}
          </th>
          <td>{FEED_KIND_LABELS[feed.kind]}</td>
          <td>{failed ? <span className="admin-warning">échec</span> : feed.readAt ? dateTimeFormat.format(new Date(feed.readAt)) : 'pas encore lu'}</td>
          <td>
            <button ref={edit} type="button" aria-label={`modifier : ${feed.name}`} disabled={busy} onClick={() => setEditing(true)}>
              modifier
            </button>{' '}
            <button type="button" aria-label={`retirer : ${feed.name}`} disabled={busy} onClick={remove}>
              retirer
            </button>
          </td>
        </tr>
      )}
      {(failed || error) && (
        // Across the table, so that a long message doesn't widen a column, and under its feed's name, while its row is
        // shown.
        <SpanRow headers={editing ? undefined : nameId}>
          {failed && (
            <p className="admin-warning">
              La dernière lecture a échoué&nbsp;: {feed.error}.{feed.readAt && ` Dernière lecture réussie le ${dateTimeFormat.format(new Date(feed.readAt))}.`}
            </p>
          )}
          {error && (
            <p className="admin-error" role="alert">
              Le calendrier n'a pas pu être retiré&nbsp;: {error}
            </p>
          )}
        </SpanRow>
      )}
    </tbody>
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
  initial: FormFields
  action: string
  failure: string
  save: (fields: FeedFields) => Promise<Saved>
  onSaved: (feed: Feed) => void
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [kind, setKind] = useState(initial.kind)
  const [link, setLink] = useState(initial.link)
  // While the server saves the feed, which can take up to 30 seconds, or longer while it goes through other calendars,
  // when it reads a new link.
  const [busy, setBusy] = useState(false)
  // Why the feed couldn't be saved, if it couldn't.
  const [error, setError] = useState<string | null>(null)
  const complete = name.trim() !== '' && kind !== null && link.trim() !== ''
  const reads = link.trim() !== initial.link

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!complete || busy) return
    setBusy(true)
    setError(null)
    const result = await save({ name, kind, link })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setName(initial.name)
    setKind(initial.kind)
    setLink(initial.link)
    onSaved(result.feed)
  }

  return (
    <>
      <form className="admin-form" onSubmit={submit}>
        <label>
          Nom
          <input autoFocus={onCancel !== undefined} value={name} maxLength={NAME_MAX_LENGTH} onChange={(event) => setName(event.target.value)} required />
        </label>
        <KindField kind={kind} onChange={setKind} />
        <label>
          Lien
          <input value={link} autoComplete="off" spellCheck={false} onChange={(event) => setLink(event.target.value)} required />
        </label>
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

// The feed's kind, one of which is picked, like a session's type (see TypeField in session-form.tsx).
function KindField({ kind, onChange }: { kind: FeedKind | null; onChange: (kind: FeedKind) => void }) {
  const name = useId()
  return (
    <fieldset className="admin-fields">
      <legend>Type</legend>
      <div className="admin-choices">
        {FEED_KINDS.map((value) => (
          <label key={value}>
            <input type="radio" name={name} checked={kind === value} onChange={() => onChange(value)} />
            {FEED_KIND_LABELS[value]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
