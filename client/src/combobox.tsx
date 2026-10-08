import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import './combobox.css'

export type ComboboxOption = { key: string; label: string }

type ComboboxProps = {
  id: string
  options: ComboboxOption[]
  // The key of the option picked, or null while none is.
  selected: string | null
  onSelect: (key: string) => void
  onBlur?: () => void
  invalid?: boolean
  placeholder?: string
}

// For matching what's typed whatever its case and accents, e.g. "etats" with "États-Unis".
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

// The options whose label contains `query`, those that start with it first, or whose key is `query`, e.g. "FR".
function matching(options: ComboboxOption[], query: string): ComboboxOption[] {
  const q = normalize(query)
  if (!q) return options
  const found = options.filter((option) => normalize(option.label).includes(q) || option.key.toLowerCase() === q)
  return [...found.filter((option) => normalize(option.label).startsWith(q)), ...found.filter((option) => !normalize(option.label).startsWith(q))]
}

// A text input that suggests the options matching what's typed, or all of them once clicked, of which only one can be
// picked: what's typed is only a way of finding it. Leaving the field without picking another option keeps the one that
// was picked, unless what's typed is exactly the label of an option, which is then picked.
export function Combobox({ id, options, selected, onSelect, onBlur, invalid, placeholder }: ComboboxProps) {
  const listId = useId()
  // What's typed, while looking for an option. Null otherwise, when the input shows the option picked.
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const open = query !== null
  const found = open ? matching(options, query) : []
  const selectedLabel = options.find((option) => option.key === selected)?.label ?? ''

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])

  // Where the option picked is when every option is shown, i.e. while nothing is typed. Starting from it there, rather
  // than from the first option, lets Enter keep it.
  const pickedIndex = () => Math.max(0, options.findIndex((option) => option.key === selected))

  const browse = () => {
    setQuery('')
    setActive(pickedIndex())
  }

  const pick = (option: ComboboxOption | undefined) => {
    if (option) onSelect(option.key)
    setQuery(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        browse()
      } else if (found.length > 0) {
        setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length)
      }
    } else if (event.key === 'Enter' && open) {
      // Picks an option rather than sending the form.
      event.preventDefault()
      pick(found[active])
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      setQuery(null)
    }
  }

  return (
    <div className="combobox">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && found.length > 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        // While browsing every option, the one picked is still shown.
        placeholder={query === '' && selectedLabel ? selectedLabel : placeholder}
        value={query ?? selectedLabel}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(normalize(event.target.value) ? 0 : pickedIndex())
        }}
        onFocus={(event) => event.target.select()}
        onClick={() => {
          if (!open) browse()
        }}
        onBlur={() => {
          if (query !== null) pick(options.find((option) => normalize(option.label) === normalize(query)))
          onBlur?.()
        }}
        onKeyDown={onKeyDown}
      />
      <ul className="combobox-list" id={listId} role="listbox" ref={listRef} hidden={!open}>
        {found.length === 0 && <li className="combobox-none">aucun résultat</li>}
        {found.map((option, index) => (
          <li
            key={option.key}
            id={`${listId}-${index}`}
            data-index={index}
            role="option"
            aria-selected={index === active}
            // On mousedown rather than click, which comes after the input has lost the focus and closed the list.
            onMouseDown={(event) => {
              event.preventDefault()
              pick(option)
            }}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
