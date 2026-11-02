import type { ReactNode } from 'react'
import type { Sorting } from './list'

// The field that searches a list of the admin sections, the headers of the columns that sort it, and the buttons that
// filter it by status (see list.ts), or change an entry's status.

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
// each with how many entries it shows (`count`). `labels` names each status, in the plural.
export function StatusFilters<S extends string>({
  all,
  statuses,
  labels,
  status,
  count,
  onChange,
}: {
  all: string
  statuses: readonly S[]
  labels: Record<S, string>
  status: S | null
  count: (status: S | null) => number
  onChange: (status: S | null) => void
}) {
  const filters: { status: S | null; label: string }[] = [{ status: null, label: all }, ...statuses.map((status) => ({ status, label: labels[status] }))]
  return (
    <div className="admin-filters" role="group" aria-label="Statut">
      {filters.map((filter) => (
        <button key={filter.label} type="button" aria-pressed={status === filter.status} onClick={() => onChange(filter.status)}>
          {filter.label} ({count(filter.status)})
        </button>
      ))}
    </div>
  )
}

// Buttons that change a status to one of the `statuses`, each named by `labels`, where the current one is pressed. They're
// named `label`, e.g. "Statut", and those that `disabled` says can't be picked are disabled.
export function StatusButtons<S extends string>({
  label = 'Statut',
  statuses,
  labels,
  status,
  disabled,
  onChange,
}: {
  label?: string
  statuses: readonly S[]
  labels: Record<S, string>
  status: S
  disabled: (status: S) => boolean
  onChange: (status: S) => void
}) {
  return (
    <div className="admin-filters" role="group" aria-label={label}>
      {statuses.map((each) => (
        <button key={each} type="button" aria-pressed={status === each} disabled={disabled(each)} onClick={() => onChange(each)}>
          {labels[each]}
        </button>
      ))}
    </div>
  )
}
