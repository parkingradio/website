import { useSearchParams } from 'react-router'
import Fuse from 'fuse.js'
import { normalize } from '../../normalize'

// What the lists of artists and applications share: a field that searches them, and columns that sort them. Both are
// kept in the URL, like the applications' status, so that going back to a list from one of its entries with the
// browser finds it as it was. The field and the columns' headers are in list-controls.tsx.

// The entries that have every word of `query` in one of their `fields`, whatever its case, accents and ligatures, e.g.
// "soeurs" for "Sœurs" (see normalize), and allowing for a typo or so, e.g. "monreal" for "Montréal". A date counts as
// one word, which only finds the entries with that day written out in a field (see readDates). They're kept in their
// order, rather than the closest matches first, since the lists are sorted by their columns.
// Only letters and digits make words, so a search without any, e.g. the "+" a phone number starts with, finds every entry,
// like an empty one, rather than none.
export function search<T>(entries: T[], query: string, fields: (entry: T) => string[]): T[] {
  if (!/[\p{L}\p{N}]/u.test(query)) return entries
  const { dates, others } = readDates(normalize(query).match(WORD) ?? [])
  const searched = entries.map((entry) => ({ entry, fields: fields(entry).map(normalize) }))
  const dated = searched.filter(({ fields }) => dates.every((date) => fields.some((field) => date.test(field))))
  const rest = others.join(' ')
  if (!/[\p{L}\p{N}]/u.test(rest)) return dated.map(({ entry }) => entry)
  const fuse = new Fuse(dated, {
    keys: [{ name: 'fields', getFn: ({ fields }) => fields }],
    // For the letters that normalize leaves, like "ø" or "ß".
    ignoreDiacritics: true,
    useTokenSearch: true,
    tokenMatch: 'all',
    // About one typo every 5 letters: short words have to be exact, or a search would find every word that shares a few
    // letters with it, e.g. "cyan" would find "Canada".
    threshold: 0.2,
    shouldSort: false,
  })
  return fuse.search(rest).map((result) => result.item.entry)
}

// What Fuse takes as words, in what it searches and what's searched for.
const WORD = /[\p{L}\p{M}\p{N}_]+/gu

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']

// The month a normalized word names, written out or by its first three letters or more, as long as no other month starts
// with them, e.g. "dec" or "juil", but not "jui".
function monthOf(word: string | undefined): string | undefined {
  const months = word && word.length >= 3 ? MONTHS.filter((month) => month.startsWith(word)) : []
  return months.length === 1 ? months[0] : undefined
}

// The day of the month a word is, e.g. "26", "01" or "1er".
function dayOf(word: string | undefined): number | undefined {
  const day = word && /^(\d\d?|1er)$/.test(word) ? parseInt(word) : 0
  return day >= 1 && day <= 31 ? day : undefined
}

// The dates among normalized `words`, as what finds them written out, e.g. "26 decembre" in "samedi 26 decembre 2026",
// and the other words. A date is a day of the month next to a month, before or after it, with or without the year after
// them. Words are read from left to right, so "3 dec 26" is "3 dec", then "26".
function readDates(words: string[]): { dates: RegExp[]; others: string[] } {
  const dates: RegExp[] = []
  const others: string[] = []
  for (let i = 0; i < words.length; ) {
    let day = dayOf(words[i])
    let month = monthOf(words[i + 1])
    if (day === undefined || month === undefined) {
      day = dayOf(words[i + 1])
      month = monthOf(words[i])
    }
    if (day === undefined || month === undefined) {
      others.push(words[i])
      i += 1
    } else {
      const year = /^\d{4}$/.test(words[i + 2] ?? '') ? ` ${words[i + 2]}` : ''
      dates.push(new RegExp(`(?<![\\p{L}\\p{N}])${day}(?:er)? ${month}${year}(?![\\p{L}\\p{N}])`, 'u'))
      i += year ? 3 : 2
    }
  }
  return { dates, others }
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
    query: params.get('search') ?? '',
    // Searching doesn't add a step to the browser's history for each letter typed.
    setQuery: (query: string) => change({ search: query || null }, { replace: true }),
  }
}

// The order of a list, and what changes it. Without a column in the URL, the list is sorted by `initial`, and without a
// direction along with the column, in descending order if the column is `descendingFirst`, or else in ascending order.
export function useSort<K extends string, T>(columns: Record<K, SortColumn<T>>, initial: NoInfer<K>): Sorting<K> & { sorted: (entries: T[]) => T[] } {
  const [params, change] = useQueryParams()
  const column = (Object.keys(columns) as K[]).find((column) => column === params.get('sort')) ?? initial
  const direction = params.get('sort') === column ? params.get('order') : null
  const sort = { column, descending: direction === 'desc' || (direction !== 'asc' && Boolean(columns[column].descendingFirst)) }

  return {
    sort,
    sortBy(column: K) {
      const descending = column === sort.column ? !sort.descending : Boolean(columns[column].descendingFirst)
      change({ sort: column, order: descending ? 'desc' : 'asc' })
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
  const status = statuses.find((status) => status === params.get('status')) ?? null
  return [status, (status) => change({ status })]
}
