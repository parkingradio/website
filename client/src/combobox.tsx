import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import './combobox.css'

// `detail` is shown next to the label, e.g. a city's region.
export type ComboboxOption = { key: string; label: string; detail?: string | null }

type ComboboxProps = {
  id: string
  options: ComboboxOption[]
  onBlur?: () => void
  invalid?: boolean
  placeholder?: string
  disabled?: boolean
  maxLength?: number
} & (
  | {
      // The key of the option picked, or null while none is.
      selected: string | null
      onSelect: (key: string) => void
      text?: undefined
    }
  | {
      selected?: undefined
      onSelect?: undefined
      // What's typed, which the parent keeps, and which picking an option replaces with its label.
      text: { value: string; onChange: (value: string) => void }
    }
)

// For matching what's typed whatever its case, accents, hyphens, apostrophes and dots, e.g. "etats unis" with
// "États-Unis", or "cote d ivoire" with "Côte d’Ivoire".
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[-'’.\s]+/g, ' ')
    .trim()
}

// The options whose label contains `query`, those that start with it first, or whose key is `query`, e.g. "FR".
function matching(options: ComboboxOption[], query: string): ComboboxOption[] {
  const q = normalize(query)
  if (!q) return options
  const found = options.filter((option) => normalize(option.label).includes(q) || option.key.toLowerCase() === q)
  return [...found.filter((option) => normalize(option.label).startsWith(q)), ...found.filter((option) => !normalize(option.label).startsWith(q))]
}

// A text input with options under it.
//
// With `selected`, it suggests the options matching what's typed, or all of them once clicked, of which only one can be
// picked: what's typed is only a way of finding it. Leaving the field without picking another option keeps the one that
// was picked, unless what's typed is exactly the label of an option, which is then picked.
//
// With `text`, what's typed is the answer, and the options are only suggestions for it, e.g. from a web service, shown
// while typing once there are some. Leaving the field without picking one keeps what's typed.
export function Combobox({ id, options, onBlur, invalid, placeholder, disabled, maxLength, ...mode }: ComboboxProps) {
  const listId = useId()
  // With `selected`: what's typed, while looking for an option. Null otherwise, when the input shows the option picked.
  const [query, setQuery] = useState<string | null>(null)
  // With `text`: whether the suggestions are shown, i.e. since the last keystroke.
  const [suggesting, setSuggesting] = useState(false)
  // The option that Enter picks. With `text`, none at first, so that Enter doesn't pick a suggestion by surprise.
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const strict = mode.text === undefined
  const found = strict ? (query === null ? [] : matching(options, query)) : options
  // A strict list says when nothing matches, while suggestions are only shown when there are some.
  const open = strict ? query !== null : suggesting && options.length > 0
  const selectedLabel = options.find((option) => option.key === mode.selected)?.label ?? ''

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])

  // Where the option picked is when every option is shown, i.e. while nothing is typed. Starting from it there, rather
  // than from the first option, lets Enter keep it.
  const pickedIndex = () => Math.max(0, options.findIndex((option) => option.key === mode.selected))

  const browse = () => {
    setQuery('')
    setActive(pickedIndex())
  }

  const close = () => {
    setQuery(null)
    setSuggesting(false)
  }

  const pick = (option: ComboboxOption | undefined) => {
    if (option) {
      if (mode.text) mode.text.onChange(option.label)
      else mode.onSelect(option.key)
    }
    close()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        // Every option, or the suggestions for what's typed, if there are some.
        if (strict) browse()
        else setSuggesting(true)
      } else if (found.length > 0) {
        const step = event.key === 'ArrowDown' ? 1 : -1
        // With none highlighted, the first one going down, and the last one going up.
        setActive(active < 0 ? (step > 0 ? 0 : found.length - 1) : (active + step + found.length) % found.length)
      }
    } else if (event.key === 'Enter' && open) {
      // Picks an option, or closes the suggestions, rather than sending the form.
      event.preventDefault()
      pick(found[active])
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
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
        aria-activedescendant={open && found[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        // Its own suggestions are the only ones, rather than also the browser's.
        autoComplete="off"
        disabled={disabled}
        maxLength={maxLength}
        // While browsing every option, the one picked is still shown.
        placeholder={query === '' && selectedLabel ? selectedLabel : placeholder}
        value={mode.text ? mode.text.value : (query ?? selectedLabel)}
        onChange={(event) => {
          if (mode.text) {
            mode.text.onChange(event.target.value)
            setSuggesting(true)
            setActive(-1)
          } else {
            setQuery(event.target.value)
            setActive(normalize(event.target.value) ? 0 : pickedIndex())
          }
        }}
        onFocus={(event) => {
          if (strict) event.target.select()
        }}
        onClick={() => {
          if (strict && query === null) browse()
        }}
        onBlur={() => {
          if (strict && query !== null) pick(options.find((option) => normalize(option.label) === normalize(query)))
          else close()
          onBlur?.()
        }}
        onKeyDown={onKeyDown}
      />
      {strict && (
        <svg className="combobox-caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="m2 4 4 4 4-4" />
        </svg>
      )}
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
            <span>{option.label}</span>
            {option.detail && <span className="combobox-detail">{option.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
