import { useId, useLayoutEffect, useRef } from 'react'
import type { ListedSet } from '../../session-fields'
import { listedSet, newSetFormValues, setFormValues, shownSet } from '../../session-fields'
import { Button } from './button'
import { MISSING, describePerformanceTypes, genreNames, setHours, setName, setTitle } from './describe'
import { Performers, SetLinks } from './set-cells'
import { SetFormWithChoices } from './set-form'
import type { SetSession } from './set-form'

// The sets listed in a new session's form, to be added with it, all at once (see "A new session's sets" in
// docs/design/client/admin/sessions.md): each one is changed in its form, or taken out of the list, without sending
// anything.

// The set whose form is open: a listed one, by its place in the list, or a new one, with the session's times as they were
// when it opened, which it works from.
export type OpenListedSet = { index: number | null; session: SetSession }

const NO_TIMES = "Indiquez d'abord quand a lieu la session."

// A key for each listed set, which stays the same while it's listed, whatever its place in the list, e.g. once a set
// before it is taken out of the list. A set that's changed is another one, with another key.
const keys = new WeakMap<ListedSet, number>()
let nextKey = 0
function keyOf(set: ListedSet): number {
  if (!keys.has(set)) keys.set(set, nextKey++)
  return keys.get(set)!
}

export function ListedSets({
  sets,
  session,
  open,
  busy,
  onChange,
  onOpen,
}: {
  sets: ListedSet[]
  // The session's times, or null while they aren't valid, when the sets' times are counted from its start.
  session: SetSession | null
  open: OpenListedSet | null
  // Whether the session is being sent, with its sets, which then can't be changed.
  busy: boolean
  onChange: (sets: ListedSet[]) => void
  onOpen: (open: OpenListedSet | null) => void
}) {
  const headingId = useId()
  // What gets the focus once a set is taken out of the list, since its × is gone: another set's ×, by its key, or the
  // heading of the sets, as on a session's page.
  const focusAfterRemove = useRef<number | 'heading' | null>(null)
  useLayoutEffect(() => {
    const next = focusAfterRemove.current
    focusAfterRemove.current = null
    if (next === 'heading') document.getElementById(headingId)?.focus()
    else if (next !== null) document.querySelector<HTMLElement>(`[data-remove="${next}"]`)?.focus()
  }, [sets, headingId])

  const shownIn = session ?? { start: null, durationMinutes: 0 }
  // As a session's page lists them: by their start, those whose place isn't known last, then in the order they were
  // added, which is their order in the list, and the server's.
  const rows = sets
    .map((set, index) => ({ index, key: keyOf(set), shown: shownSet(set, shownIn) }))
    .sort((a, b) => (a.shown.offsetMinutes ?? Infinity) - (b.shown.offsetMinutes ?? Infinity) || a.index - b.index)
  const remove = (index: number) => {
    // The focus goes to the next set's ×, or the previous one's, or else to the heading of the sets.
    const row = rows.findIndex((row) => row.index === index)
    focusAfterRemove.current = (rows[row + 1] ?? rows[row - 1])?.key ?? 'heading'
    onChange(sets.filter((_, i) => i !== index))
    if (open?.index === index) onOpen(null)
    // The open form's set moves up in the list.
    else if (open?.index != null && open.index > index) onOpen({ ...open, index: open.index - 1 })
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1}>
        Sets
      </h2>
      <div className="admin-toolbar">
        <Button unavailable={session ? null : NO_TIMES} disabled={busy} onClick={() => onOpen({ index: null, session: session! })}>
          ajouter un set
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="admin-placeholder">Aucun set.</p>
      ) : (
        <table className="admin-table admin-table-controls" aria-label="Sets">
          <thead>
            <tr>
              <th>Heure</th>
              <th>Artistes</th>
              <th>Prestation</th>
              <th>Genres</th>
              <th>Liens</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ index, key, shown }) => (
              <tr key={key}>
                <td className="admin-day">{setHours(shown)}</td>
                {/* Its links open in a new tab, so that the form isn't left. */}
                <td>{shown.performers.length > 0 ? <Performers performers={shown.performers} newTab /> : MISSING}</td>
                <td>{describePerformanceTypes(shown)}</td>
                <td>{genreNames(shown.genres)}</td>
                <td>
                  <SetLinks set={shown} newTab />
                </td>
                <td>
                  <Button
                    aria-label={`modifier : ${setName(shown)}`}
                    unavailable={session ? null : NO_TIMES}
                    disabled={busy}
                    onClick={() => onOpen({ index, session: session! })}
                  >
                    modifier
                  </Button>{' '}
                  <button type="button" data-remove={key} aria-label={`retirer : ${setName(shown)}`} disabled={busy} onClick={() => remove(index)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <SetFormWithChoices
          // Afresh for each set, but not when another one is taken out of the list.
          key={open.index === null ? 'new' : keyOf(sets[open.index])}
          title={open.index === null ? 'Nouveau set' : setTitle(sets[open.index])}
          session={open.session}
          initial={
            open.index === null
              ? newSetFormValues({ ...open.session, sets: sets.map((set) => shownSet(set, open.session)) })
              : setFormValues(shownSet(sets[open.index], open.session), open.session)
          }
          submitLabel={open.index === null ? 'ajouter le set' : 'enregistrer'}
          onCancel={() => onOpen(null)}
          onSubmit={async (fields, form) => {
            const set = listedSet(fields, form)
            onChange(open.index === null ? [...sets, set] : sets.map((other, i) => (i === open.index ? set : other)))
            onOpen(null)
            return null
          }}
        />
      )}
    </section>
  )
}
