import { useId, useLayoutEffect, useRef } from 'react'
import type { ListedSet } from '../../session-fields'
import { listedSet, newSetFormValues, setFormValues, shownSet } from '../../session-fields'
import { MISSING, describePerformanceTypes, genreNames, setDuration, setName, setTitle } from './describe'
import { MoveButtons, Performers, SetLinks, SetsTooLong } from './set-cells'
import { SetFormWithChoices } from './set-form'
import type { SetSession } from './set-form'

// The sets listed in a new session's form, to be added with it, all at once (see "A new session's sets" in
// docs/design/client/admin/sessions.md): each one is changed in its form, or taken out of the list, without sending
// anything.

// The set whose form is open: a listed one, by its place in the list, or a new one, with the session's duration as it
// was when it opened, which it works from.
export type OpenListedSet = { index: number | null; session: SetSession }

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
  // The session's duration, as its form has it.
  session: SetSession
  open: OpenListedSet | null
  // Whether the session is being sent, with its sets, which then can't be changed.
  busy: boolean
  onChange: (sets: ListedSet[]) => void
  onOpen: (open: OpenListedSet | null) => void
}) {
  const headingId = useId()
  // What gets the focus once the sets change, since the button that changed them can be gone, disabled or moved, which
  // loses it: a set's button, by its key and what it does, or the heading of the sets, as on a session's page.
  const focusNext = useRef<{ key: number; action: 'up' | 'down' | 'remove' } | 'heading' | null>(null)
  useLayoutEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === 'heading') document.getElementById(headingId)?.focus()
    else if (next !== null) document.querySelector<HTMLElement>(`[data-set="${next.key}"][data-action="${next.action}"]`)?.focus()
  }, [sets, headingId])

  // In their order, which is the one they're added in.
  const rows = sets.map((set, index) => ({ index, key: keyOf(set), shown: shownSet(set) }))
  const remove = (index: number) => {
    // The focus goes to the next set's ×, or the previous one's, or else to the heading of the sets.
    const next = rows[index + 1] ?? rows[index - 1]
    focusNext.current = next ? { key: next.key, action: 'remove' } : 'heading'
    onChange(sets.filter((_, i) => i !== index))
    if (open?.index === index) onOpen(null)
    // The open form's set moves up in the list.
    else if (open?.index != null && open.index > index) onOpen({ ...open, index: open.index - 1 })
  }
  // Swaps the set at `index` with the one `by` places from it, the open form's set included.
  const move = (index: number, by: -1 | 1) => {
    const moved = [...sets]
    ;[moved[index], moved[index + by]] = [moved[index + by], moved[index]]
    // The same arrow, unless the set is now at the end where it can't be used.
    const end = by < 0 ? 0 : sets.length - 1
    const [arrow, other] = by < 0 ? (['up', 'down'] as const) : (['down', 'up'] as const)
    focusNext.current = { key: keyOf(sets[index]), action: index + by === end ? other : arrow }
    onChange(moved)
    if (open?.index === index) onOpen({ ...open, index: index + by })
    else if (open?.index === index + by) onOpen({ ...open, index })
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1}>
        Sets
      </h2>
      <div className="admin-toolbar">
        <button type="button" disabled={busy} onClick={() => onOpen({ index: null, session })}>
          ajouter un set
        </button>
      </div>
      <SetsTooLong sets={sets} durationMinutes={session.durationMinutes} />
      {rows.length === 0 ? (
        <p className="admin-placeholder">Aucun set.</p>
      ) : (
        <table className="admin-table admin-table-controls" aria-label="Sets">
          <thead>
            <tr>
              <th>Durée</th>
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
                <td className="admin-day">{setDuration(shown)}</td>
                {/* Its links open in a new tab, so that the form isn't left. */}
                <td>{shown.performers.length > 0 ? <Performers performers={shown.performers} newTab /> : MISSING}</td>
                <td>{describePerformanceTypes(shown)}</td>
                <td>{genreNames(shown.genres)}</td>
                <td>
                  <SetLinks set={shown} newTab />
                </td>
                <td>
                  <MoveButtons
                    name={setName(shown)}
                    first={index === 0}
                    last={index === rows.length - 1}
                    disabled={busy}
                    data={{ 'data-set': key }}
                    onMove={(by) => move(index, by)}
                  />{' '}
                  <button type="button" aria-label={`modifier : ${setName(shown)}`} disabled={busy} onClick={() => onOpen({ index, session })}>
                    modifier
                  </button>{' '}
                  <button
                    type="button"
                    data-set={key}
                    data-action="remove"
                    aria-label={`retirer : ${setName(shown)}`}
                    disabled={busy}
                    onClick={() => remove(index)}
                  >
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
          initial={open.index === null ? newSetFormValues({ ...open.session, sets }) : setFormValues(shownSet(sets[open.index]))}
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
