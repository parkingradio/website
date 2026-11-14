import { useSearchParams } from 'react-router'
import Fuse from 'fuse.js'
import { normalize } from '../../normalize'

// What the lists of artists and applications share: a field that searches them, and columns that sort them. Both are
// kept in the URL, like the applications' status, so that going back to a list from one of its entries with the
// browser finds it as it was, and an application's page goes through the list it was opened from. The field and the
// columns' headers are in list-controls.tsx.

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
// Any month, written out, in a regular expression.
const ANY_MONTH = `(?:${MONTHS.join('|')})`
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

// The one of `names` a normalized word is, written out or by its first three letters or more, as long as no other one
// starts with them, e.g. the months "dec" or "juil", but not "jui".
function nameIn(names: string[], word: string | undefined): string | undefined {
  const found = word && word.length >= 3 ? names.filter((name) => name.startsWith(word)) : []
  return found.length === 1 ? found[0] : undefined
}

// The day of the month a word is, e.g. "26", "01" or "1er".
function dayOf(word: string | undefined): number | undefined {
  const day = word && /^(\d\d?|1er)$/.test(word) ? parseInt(word) : 0
  return day >= 1 && day <= 31 ? day : undefined
}

// A weekday and a month a day of the month is written out with, either of which may be missing.
type Names = { weekday?: string; month?: string }

// What a normalized word can name next to a day of the month: a weekday, a month, or either, like "mar" (mardi or mars).
function namesOf(word: string | undefined): Names | undefined {
  const names = { weekday: nameIn(WEEKDAYS, word), month: nameIn(MONTHS, word) }
  return names.weekday || names.month ? names : undefined
}

// What a word next to a day of the month can be on its own: each name it can be, e.g. mardi or mars for "mar".
function alone(names: Names): Names[] {
  return [{ weekday: names.weekday }, { month: names.month }].filter(({ weekday, month }) => weekday || month)
}

// What the words on both sides of a day of the month can be together: a weekday and a month, e.g. "mar" and "jan" are
// mardi and janvier, but two months, or two weekdays, are nothing.
function paired(a: Names, b: Names): Names[] {
  return [
    { weekday: a.weekday, month: b.month },
    { weekday: b.weekday, month: a.month },
  ].filter(({ weekday, month }) => weekday && month)
}

// The dates among normalized `words`, as what finds them written out, e.g. "26 decembre" or "samedi 26" in "samedi 26
// decembre 2026", and the other words. A date is a day of the month with a month or a weekday next to it, before or after
// it, or a weekday on one side and a month on the other, with or without the year after them. Words are read from left
// to right, so "3 dec 26" is "3 dec", then "26".
function readDates(words: string[]): { dates: RegExp[]; others: string[] } {
  const dates: RegExp[] = []
  const others: string[] = []
  for (let i = 0; i < words.length; ) {
    const before = namesOf(words[i])
    const at = before ? i + 1 : i
    const day = dayOf(words[at])
    const after = namesOf(words[at + 1])
    // The word after the day only goes with the one before it if they make a weekday and a month. Otherwise, it starts
    // what's read next, e.g. "janv" in "dec 26 janv 3".
    const pairs = before && after ? paired(before, after) : []
    const names = before ?? after
    if (day === undefined || names === undefined) {
      others.push(words[i])
      i += 1
      continue
    }
    const readings = pairs.length > 0 ? pairs : alone(names)
    let end = pairs.length > 0 || !before ? at + 2 : at + 1
    const year = /^\d{4}$/.test(words[end] ?? '') ? ` ${words[end]}` : ''
    if (year) end += 1
    // As days are written out, e.g. "samedi 26 decembre 2026", with any month when there's none.
    const written = readings.map(({ weekday, month }) => `${weekday ? `${weekday} ` : ''}${day}(?:er)? ${month ?? ANY_MONTH}${year}`)
    dates.push(new RegExp(`(?<![\\p{L}\\p{N}])(?:${written.join('|')})(?![\\p{L}\\p{N}])`, 'u'))
    i = end
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

// The status a list is filtered by, or null for every status, what changes it, and whether the URL gives it. The URL says
// which, with `all` for every status, and without one of `statuses`, the list shows `initial`, its default view.
export function useStatusFilter<S extends string>(statuses: readonly S[], initial: NoInfer<S>): [S | null, (status: S | null) => void, boolean] {
  const [params, change] = useQueryParams()
  const param = params.get('status')
  const given = statuses.find((status) => status === param)
  const status = param === 'all' ? null : (given ?? initial)
  return [status, (status) => change({ status: status ?? 'all' }), param === 'all' || given !== undefined]
}

// The query that keeps a list as it is in another address, e.g. its entries' pages': its `status`, or `all`, even for its
// default view, so that those pages tell they were opened from the list, then its search and order, as the URL has them.
export function listQuery(params: URLSearchParams, status: string | null): string {
  const query = new URLSearchParams({ status: status ?? 'all' })
  for (const name of ['search', 'sort', 'order']) {
    const value = params.get(name)
    if (value !== null) query.set(name, value)
  }
  return `?${query}`
}
