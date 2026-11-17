import type { ComboboxOption } from './combobox'
import { normalize } from './normalize'

// The options whose label contains `query`, those that start with it first, or whose key is `query`, e.g. "FR", which a
// combobox finds unless it's given a `filter` of its own (see combobox.tsx). In a module of its own, so that such a
// filter can start from it.
export function matching(options: ComboboxOption[], query: string): ComboboxOption[] {
  const q = normalize(query)
  if (!q) return options
  const found = options.filter((option) => normalize(option.label).includes(q) || option.key.toLowerCase() === q)
  return [...found.filter((option) => normalize(option.label).startsWith(q)), ...found.filter((option) => !normalize(option.label).startsWith(q))]
}
