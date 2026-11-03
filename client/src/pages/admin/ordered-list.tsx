import { useLayoutEffect, useRef } from 'react'

// Picks in order, e.g. a collective's artists or a set's performers, one per line, each of which can be moved up or down
// or removed.

type OrderedListProps<T> = {
  items: T[]
  // What tells items apart, e.g. as React's keys.
  keyOf: (item: T) => string
  // What's shown of an item, and the name its buttons say, e.g. "monter Aurore", which is what's shown unless it's given.
  label: (item: T) => string
  name?: (item: T) => string
  onChange: (items: T[]) => void
  // The id of what gets the focus once the last item is removed, e.g. the field that adds one.
  nextFocus: string
}

export function OrderedList<T>({ items, keyOf, label, name = label, onChange, nextFocus }: OrderedListProps<T>) {
  const list = useRef<HTMLOListElement>(null)
  // What gets the focus once the items change, since the button that changed them can be gone, disabled or moved, which
  // loses it: a button of an item, by its key, or else `nextFocus`.
  const focusNext = useRef<{ key: string; action: 'up' | 'down' | 'remove' } | 'next' | null>(null)
  // A layout effect: for a click React runs a passive one in the same commit too, but not when the change follows a
  // request (see LoadedSession in sessions.tsx).
  useLayoutEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === 'next') document.getElementById(nextFocus)?.focus()
    else if (next) {
      const item = Array.from(list.current?.children ?? []).find((item) => (item as HTMLElement).dataset.item === next.key)
      item?.querySelector<HTMLElement>(`[data-action="${next.action}"]`)?.focus()
    }
  }, [items, nextFocus])

  const move = (index: number, by: number) => {
    const moved = [...items]
    ;[moved[index], moved[index + by]] = [moved[index + by], moved[index]]
    // The same arrow, unless the item is now at the end where it's disabled.
    const [arrow, other] = by < 0 ? (['up', 'down'] as const) : (['down', 'up'] as const)
    const end = by < 0 ? 0 : items.length - 1
    focusNext.current = { key: keyOf(items[index]), action: index + by === end ? other : arrow }
    onChange(moved)
  }
  const remove = (index: number) => {
    const next = items[index + 1]
    focusNext.current = next ? { key: keyOf(next), action: 'remove' } : 'next'
    onChange(items.filter((_, i) => i !== index))
  }

  if (items.length === 0) return null
  return (
    <ol ref={list} className="admin-chosen admin-ordered">
      {items.map((item, index) => (
        <li key={keyOf(item)} data-item={keyOf(item)}>
          <b>{index + 1}</b>
          {label(item)}
          <button type="button" data-action="up" aria-label={`monter ${name(item)}`} disabled={index === 0} onClick={() => move(index, -1)}>
            ↑
          </button>
          <button
            type="button"
            data-action="down"
            aria-label={`descendre ${name(item)}`}
            disabled={index === items.length - 1}
            onClick={() => move(index, 1)}
          >
            ↓
          </button>
          <button type="button" data-action="remove" aria-label={`retirer ${name(item)}`} onClick={() => remove(index)}>
            ×
          </button>
        </li>
      ))}
    </ol>
  )
}
