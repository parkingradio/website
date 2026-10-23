import type { ReactNode } from 'react'
import type { Sorting } from './list'

// The field that searches a list of the admin sections, and the headers of the columns that sort it (see list.ts).

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
