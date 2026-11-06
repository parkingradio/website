import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { normalize } from './normalize'
import './combobox.css'

// `detail` is shown next to the label, e.g. a city's region. A `disabled` option is shown, but can't be picked.
export type ComboboxOption = { key: string; label: string; detail?: string | null; disabled?: boolean }
// The options that what's typed finds, in the order they're shown.
export type ComboboxFilter = (options: ComboboxOption[], query: string) => ComboboxOption[]

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
      // In place of `matching`.
      filter?: ComboboxFilter
      text?: undefined
    }
  | {
      selected?: undefined
      onSelect?: undefined
      filter?: undefined
      // What's typed, which the parent keeps, and which picking an option replaces with its label.
      text: { value: string; onChange: (value: string) => void }
    }
)

// The options whose label contains `query`, those that start with it first, or whose key is `query`, e.g. "FR", unless
// the combobox is given a `filter` of its own.
function matching(options: ComboboxOption[], query: string): ComboboxOption[] {
  const q = normalize(query)
  if (!q) return options
  const found = options.filter((option) => normalize(option.label).includes(q) || option.key.toLowerCase() === q)
  return [...found.filter((option) => normalize(option.label).startsWith(q)), ...found.filter((option) => !normalize(option.label).startsWith(q))]
}

// The first option that can be picked, starting at `from` and going by `step`, around the list, or -1 if there's none.
function enabled(options: ComboboxOption[], from: number, step: 1 | -1): number {
  for (let i = 0; i < options.length; i++) {
    const index = (((from + i * step) % options.length) + options.length) % options.length
    if (!options[index].disabled) return index
  }
  return -1
}

// A text input with options under it.
//
// With `selected`, it suggests the options matching what's typed, or all of them once clicked, of which only one can be
// picked: what's typed is only a way of finding it. Leaving the field without picking another option keeps the one that
// was picked, unless what's typed is exactly the label of an option that can be picked, which is then picked.
//
// With `text`, what's typed is the answer, and the options are only suggestions for it, e.g. from a web service, shown
// while typing once there are some. Leaving the field without picking one keeps what's typed.
//
// The option that Enter picks is highlighted, and both the arrow keys and the mouse move it.
export function Combobox({ id, options, onBlur, invalid, placeholder, disabled, maxLength, ...mode }: ComboboxProps) {
  const listId = useId()
  // With `selected`: what's typed, while looking for an option. Null otherwise, when the input shows the option picked.
  const [query, setQuery] = useState<string | null>(null)
  // With `text`: whether the suggestions are shown, i.e. since the last keystroke.
  const [suggesting, setSuggesting] = useState(false)
  // The option that Enter picks. With `text`, none at first, so that Enter doesn't pick a suggestion by surprise.
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  // Whether the option that Enter picks has to be scrolled to once it's shown: it does when the keyboard moves it, but
  // not when the mouse does, since it's under the mouse already, and scrolling would move another option under it.
  const scrollToActive = useRef(false)
  // Where the mouse last moved over the options, to tell its moves from the events some browsers fire when the list
  // scrolls under a mouse that stays still, e.g. as the keyboard moves the highlight.
  const mouseAt = useRef<string | null>(null)

  const strict = mode.text === undefined
  const find = mode.filter ?? matching
  // Kept between renders, e.g. as the mouse moves over the options, since a `filter` can be costly, e.g. a fuzzy search
  // over hundreds of options.
  const found = useMemo(() => (strict ? (query === null ? [] : find(options, query)) : options), [strict, query, find, options])
  // A strict list says when nothing matches, while suggestions are only shown when there are some.
  const open = strict ? query !== null : suggesting && options.length > 0
  const selectedLabel = options.find((option) => option.key === mode.selected)?.label ?? ''
  // The option highlighted, if it can be picked, which it can't be only once the options change under it.
  const current = found[active] && !found[active].disabled ? active : -1

  // After every render rather than when the option changes, since typing can leave it at the same place while the options
  // under it change.
  useEffect(() => {
    if (!scrollToActive.current) return
    scrollToActive.current = false
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  })

  // Moves the highlight, from the keyboard or as what's typed changes, and scrolls to it.
  const highlight = (index: number) => {
    scrollToActive.current = true
    setActive(index)
  }

  // Where the option picked is when every option is shown, i.e. while nothing is typed. Starting from it there, rather
  // than from the first option, lets Enter keep it.
  const pickedIndex = () => {
    const index = options.findIndex((option) => option.key === mode.selected)
    return index >= 0 && !options[index].disabled ? index : enabled(options, 0, 1)
  }

  const browse = () => {
    setQuery('')
    highlight(pickedIndex())
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
        else {
          highlight(active)
          setSuggesting(true)
        }
      } else if (found.length > 0) {
        const step = event.key === 'ArrowDown' ? 1 : -1
        // With none highlighted, the first one going down, and the last one going up. Options that can't be picked are
        // skipped, as a native select does, rather than highlighted.
        highlight(enabled(found, active < 0 ? (step > 0 ? 0 : found.length - 1) : active + step, step))
      }
    } else if (event.key === 'Enter' && open) {
      // Picks an option, or closes the suggestions, rather than sending the form.
      event.preventDefault()
      pick(found[current])
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
        aria-activedescendant={open && current >= 0 ? `${listId}-${current}` : undefined}
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
            highlight(normalize(event.target.value) ? enabled(find(options, event.target.value), 0, 1) : pickedIndex())
          }
        }}
        onFocus={(event) => {
          if (strict) event.target.select()
        }}
        onClick={() => {
          if (strict && query === null) browse()
        }}
        onBlur={() => {
          if (strict && query !== null) pick(options.find((option) => !option.disabled && normalize(option.label) === normalize(query)))
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
            aria-selected={index === current}
            aria-disabled={option.disabled || undefined}
            onMouseMove={(event) => {
              const at = `${event.screenX},${event.screenY}`
              if (at === mouseAt.current) return
              mouseAt.current = at
              if (!option.disabled && index !== active) setActive(index)
            }}
            // On mousedown rather than click, which comes after the input has lost the focus and closed the list.
            onMouseDown={(event) => {
              event.preventDefault()
              // One that can't be picked leaves the list as it is.
              if (!option.disabled) pick(option)
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
