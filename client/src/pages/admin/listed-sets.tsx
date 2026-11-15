import { useId } from 'react'
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

export function ListedSets({
  sets,
  session,
  open,
  onChange,
  onOpen,
}: {
  sets: ListedSet[]
  // The session's times, or null while they aren't valid, when the sets' times are counted from its start.
  session: SetSession | null
  open: OpenListedSet | null
  onChange: (sets: ListedSet[]) => void
  onOpen: (open: OpenListedSet | null) => void
}) {
  const headingId = useId()
  const shownIn = session ?? { start: null, durationMinutes: 0 }
  // As a session's page lists them: by their start, those whose place isn't known last, then in the order they were
  // added, which is their order in the list, and the server's.
  const rows = sets
    .map((set, index) => ({ index, shown: shownSet(set, shownIn) }))
    .sort((a, b) => (a.shown.offsetMinutes ?? Infinity) - (b.shown.offsetMinutes ?? Infinity) || a.index - b.index)
  const remove = (index: number) => {
    onChange(sets.filter((_, i) => i !== index))
    if (open?.index === index) onOpen(null)
    // The open form's set moves up in the list.
    else if (open?.index != null && open.index > index) onOpen({ ...open, index: open.index - 1 })
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Sets</h2>
      <div className="admin-toolbar">
        <Button unavailable={session ? null : NO_TIMES} onClick={() => onOpen({ index: null, session: session! })}>
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
            {rows.map(({ index, shown }) => (
              <tr key={index}>
                <td className="admin-day">{setHours(shown)}</td>
                <td>{shown.performers.length > 0 ? <Performers performers={shown.performers} /> : MISSING}</td>
                <td>{describePerformanceTypes(shown)}</td>
                <td>{genreNames(shown.genres)}</td>
                <td>
                  <SetLinks set={shown} />
                </td>
                <td>
                  <Button
                    aria-label={`modifier : ${setName(shown)}`}
                    unavailable={session ? null : NO_TIMES}
                    onClick={() => onOpen({ index, session: session! })}
                  >
                    modifier
                  </Button>{' '}
                  <button type="button" aria-label={`retirer : ${setName(shown)}`} onClick={() => remove(index)}>
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
          // Afresh for each set.
          key={open.index ?? 'new'}
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
