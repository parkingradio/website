import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from './button'
import type { Sorting } from './list'

// The field that searches a list of the admin sections, the headers of the columns that sort it, and the buttons that
// filter it by status (see list.ts), or the buttons, or the dropdown, that change an entry's status.

export function SearchField({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  return (
    <input
      type="search"
      className="admin-search"
      aria-label="Rechercher"
      placeholder="rechercher"
      value={query}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

// The header of a column that sorts the list, with an arrow when the list is sorted by it.
export function SortHeader<K extends string>({ column, sorting: { sort, sortBy }, children }: { column: K; sorting: Sorting<K>; children: ReactNode }) {
  const sorted = sort.column === column
  return (
    <th aria-sort={sorted ? (sort.descending ? 'descending' : 'ascending') : undefined}>
      <button type="button" className="admin-sort" onClick={() => sortBy(column)}>
        {children}
        <span aria-hidden="true">{sorted && (sort.descending ? ' ↓' : ' ↑')}</span>
      </button>
    </th>
  )
}

// Buttons that show only the entries with one of the `statuses`, in that order, or all of them (`all`, e.g. "toutes"),
// each with how many entries it shows (`count`). `labels` names each status, in the plural. They're named `label`, e.g.
// "Statut".
export function StatusFilters<S extends string>({
  label = 'Statut',
  all,
  statuses,
  labels,
  status,
  count,
  onChange,
}: {
  label?: string
  all: string
  statuses: readonly S[]
  labels: Record<S, string>
  status: S | null
  count: (status: S | null) => number
  onChange: (status: S | null) => void
}) {
  const filters: { status: S | null; label: string }[] = [{ status: null, label: all }, ...statuses.map((status) => ({ status, label: labels[status] }))]
  return (
    <div className="admin-filters" role="group" aria-label={label}>
      {filters.map((filter) => (
        <button key={filter.label} type="button" aria-pressed={status === filter.status} onClick={() => onChange(filter.status)}>
          {filter.label} ({count(filter.status)})
        </button>
      ))}
    </div>
  )
}

// Buttons that change a status to one of the `statuses`, each named by `labels`, where the current one is pressed, and
// is the only one that's black, even while another one is hovered, e.g. the one just clicked, when the entry didn't get
// that status, like an application whose cancelled sets keep it "retenue" once it's made "nouvelle". They're named
// `label`, e.g. "Statut". They're disabled while `disabled`, e.g. while a change is saved, but those that a rule
// keeps from being picked are greyed out, saying why (`unavailable`, see button.tsx).
export function StatusButtons<S extends string>({
  label = 'Statut',
  statuses,
  labels,
  status,
  disabled,
  unavailable,
  onChange,
}: {
  label?: string
  statuses: readonly S[]
  labels: Record<S, string>
  status: S
  disabled: boolean
  unavailable?: (status: S) => string | null
  onChange: (status: S) => void
}) {
  return (
    <div className="admin-filters admin-status-buttons" role="group" aria-label={label}>
      {statuses.map((each) => (
        <Button key={each} aria-pressed={status === each} disabled={disabled} unavailable={unavailable?.(each)} onClick={() => onChange(each)}>
          {labels[each]}
        </Button>
      ))}
    </div>
  )
}

// A status, as a dropdown named `label` that changes it to another of the `statuses`, each named by `labels`, e.g. in a
// row of a list. It shows the one picked, and can't be used while it's saved, nor while `disabled`.
export function StatusSelect<S extends string>({
  label,
  statuses,
  labels,
  status,
  disabled = false,
  onChange,
}: {
  label: string
  statuses: readonly S[]
  labels: Record<S, string>
  status: S
  disabled?: boolean
  onChange: (status: S) => Promise<void>
}) {
  const [saving, setSaving] = useState<S | null>(null)
  const locked = disabled || saving !== null
  const select = useRef<HTMLSelectElement>(null)
  // Browsers take the focus away from a control once it's disabled, as it is while its status is saved, which would lose
  // the keyboard's place: it gets the focus back once it can be used again, if it had it when the status was picked and
  // no other control has taken it since.
  const refocus = useRef(false)
  useLayoutEffect(() => {
    if (locked || !refocus.current) return
    refocus.current = false
    if (document.activeElement === null || document.activeElement === document.body) select.current?.focus()
  }, [locked])
  return (
    <select
      ref={select}
      className="admin-status-select"
      aria-label={label}
      value={saving ?? status}
      disabled={locked}
      onChange={async (event) => {
        const picked = event.target.value as S
        refocus.current = document.activeElement === event.target
        setSaving(picked)
        await onChange(picked)
        setSaving(null)
      }}
    >
      {statuses.map((each) => (
        <option key={each} value={each}>
          {labels[each]}
        </option>
      ))}
    </select>
  )
}
