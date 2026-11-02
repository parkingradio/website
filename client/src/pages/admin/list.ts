import { useSearchParams } from 'react-router'
import Fuse from 'fuse.js'

// What the lists of artists and applications share: a field that searches them, and columns that sort them. Both are
// kept in the URL, like the applications' status, so that going back to a list from one of its entries with the
// browser finds it as it was. The field and the columns' headers are in list-controls.tsx.

// The entries that have every word of `query` in one of their `fields`, whatever its case and accents, and allowing for a
// typo or so, e.g. "monreal" for "Montréal". They're kept in their order, rather than the closest matches first, since
// the lists are sorted by their columns.
// Only letters and digits make words, so a search without any, e.g. the "+" a phone number starts with, finds every entry,
// like an empty one, rather than none.
export function search<T>(entries: T[], query: string, fields: (entry: T) => string[]): T[] {
  if (!/[\p{L}\p{N}]/u.test(query)) return entries
  const fuse = new Fuse(entries, {
    keys: [{ name: 'fields', getFn: fields }],
    ignoreDiacritics: true,
    useTokenSearch: true,
    tokenMatch: 'all',
    // About one typo every 5 letters: short words have to be exact, or a search would find every word that shares a few
    // letters with it, e.g. "cyan" would find "Canada".
    threshold: 0.2,
    shouldSort: false,
  })
  return fuse.search(query).map((result) => result.item)
}

// A column a list can be sorted by. `compare` puts entries in ascending order. Sorting by the column starts in
// descending order if `descendingFirst`, e.g. for dates, most recent first.
export type SortColumn<T> = { compare: (a: T, b: T) => number; descendingFirst?: boolean }
export type Sort<K extends string> = { column: K; descending: boolean }
// How a list is sorted, and what sorts it by a column, or the other way around if it already is.
export type Sorting<K extends string> = { sort: Sort<K>; sortBy: (column: K) => void }

// Names and places, the French way: accents don't count, and "DJ 2" comes before "DJ 10".
export const compareText = new Intl.Collator('fr', { sensitivity: 'base', numeric: true }).compare

// The URL's parameters, and what changes some of them while keeping the others. Null removes a parameter.
export function useQueryParams(): [URLSearchParams, (changes: Record<string, string | null>, options?: { replace: boolean }) => void] {
  const [params, setParams] = useSearchParams()
  function change(changes: Record<string, string | null>, options?: { replace: boolean }) {
    setParams((params) => {
      const changed = new URLSearchParams(params)
      for (const [name, value] of Object.entries(changes)) {
        if (value === null) changed.delete(name)
        else changed.set(name, value)
      }
      return changed
    }, options)
  }
  return [params, change]
}

// What a list is searched for, and what changes it.
export function useSearchQuery() {
  const [params, change] = useQueryParams()
  return {
    query: params.get('recherche') ?? '',
    // Searching doesn't add a step to the browser's history for each letter typed.
    setQuery: (query: string) => change({ recherche: query || null }, { replace: true }),
  }
}

// The order of a list, and what changes it. Without a column in the URL, the list is sorted by `initial`, and without a
// direction, the way the column's header first sorts it.
export function useSort<K extends string, T>(columns: Record<K, SortColumn<T>>, initial: NoInfer<K>): Sorting<K> & { sorted: (entries: T[]) => T[] } {
  const [params, change] = useQueryParams()
  const column = (Object.keys(columns) as K[]).find((column) => column === params.get('tri')) ?? initial
  const direction = params.get('tri') === column ? params.get('ordre') : null
  const sort = { column, descending: direction === 'desc' || (direction !== 'asc' && Boolean(columns[column].descendingFirst)) }

  return {
    sort,
    sortBy(column: K) {
      const descending = column === sort.column ? !sort.descending : Boolean(columns[column].descendingFirst)
      change({ tri: column, ordre: descending ? 'desc' : 'asc' })
    },
    // Entries that are equal stay in the order they were in.
    sorted(entries: T[]): T[] {
      const { compare } = columns[sort.column]
      return entries.toSorted((a, b) => (sort.descending ? compare(b, a) : compare(a, b)))
    },
  }
}

// The status a list is filtered by, in the URL, if it's one of `statuses`, and what changes it, or removes it (null).
export function useStatusFilter<S extends string>(statuses: readonly S[]): [S | null, (status: S | null) => void] {
  const [params, change] = useQueryParams()
  const status = statuses.find((status) => status === params.get('statut')) ?? null
  return [status, (status) => change({ statut: status })]
}
