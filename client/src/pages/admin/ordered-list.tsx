import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { DragHandle, SortableList } from './sortable'
import { arrayMove, useSortableItem } from './use-sortable'

// Picks in order, e.g. a collective's artists or a set's performers, one per line, each of which can be dragged to
// another place by its handle (see sortable.tsx), or removed.

type OrderedListProps<T> = {
  items: T[]
  // What tells items apart, e.g. as React's keys.
  keyOf: (item: T) => string
  // What's shown of an item, unless `text` is given, and the name its buttons say, e.g. "retirer Aurore", unless `name` is.
  label: (item: T) => string
  name?: (item: T) => string
  // What's shown in place of an item's label, if anything, e.g. a set of the radio's rotation, with its session.
  text?: (item: T) => ReactNode
  // What's shown before an item's label, from it and its index, if anything, e.g. when a set goes on air in the radio's
  // rotation.
  lead?: (item: T, index: number) => ReactNode
  onChange: (items: T[]) => void
  // The id of what gets the focus once the last item is removed, e.g. the field that adds one.
  nextFocus: string
  // While the list can't be changed, e.g. while it's sent.
  disabled?: boolean
  // For a list that can be longer than the screen (see `SortableList`).
  autoScroll?: boolean
}

export function OrderedList<T>({ items, keyOf, label, name = label, text, lead, onChange, nextFocus, disabled = false, autoScroll }: OrderedListProps<T>) {
  const list = useRef<HTMLOListElement>(null)
  // What gets the focus once an item is removed, since its × is gone: the next item's ×, by its key, or else `nextFocus`.
  const focusNext = useRef<{ key: string } | 'next' | null>(null)
  // A layout effect: for a click React runs a passive one in the same commit too, but not when the change follows a
  // request (see LoadedSession in sessions.tsx).
  useLayoutEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === 'next') document.getElementById(nextFocus)?.focus()
    else if (next) {
      const item = Array.from(list.current?.children ?? []).find((item) => (item as HTMLElement).dataset.item === next.key)
      item?.querySelector<HTMLElement>('[data-action="remove"]')?.focus()
    }
  }, [items, nextFocus])

  const remove = (index: number) => {
    const next = items[index + 1]
    focusNext.current = next ? { key: keyOf(next) } : 'next'
    onChange(items.filter((_, i) => i !== index))
  }

  if (items.length === 0) return null
  const keys = items.map(keyOf)
  return (
    <SortableList
      ids={keys}
      nameOf={(index) => name(items[index])}
      disabled={disabled}
      autoScroll={autoScroll}
      onMove={(from, to) => onChange(arrayMove(items, from, to))}
    >
      <ol ref={list} className="admin-chosen admin-ordered">
        {items.map((item, index) => (
          <OrderedItem
            key={keys[index]}
            id={keys[index]}
            number={index + 1}
            label={label(item)}
            name={name(item)}
            text={text?.(item)}
            lead={lead?.(item, index)}
            disabled={disabled}
            onRemove={() => remove(index)}
          />
        ))}
      </ol>
    </SortableList>
  )
}

type OrderedItemProps = {
  id: string
  number: number
  label: string
  name: string
  text: ReactNode
  lead: ReactNode
  disabled: boolean
  onRemove: () => void
}

function OrderedItem({ id, number, label, name, text, lead, disabled, onRemove }: OrderedItemProps) {
  const { ref, style, dragging, handle } = useSortableItem(id)
  return (
    <li ref={ref} style={style} data-item={id} data-dragging={dragging || undefined}>
      <DragHandle handle={handle} label={`réordonner ${name}`} />
      <b>{number}</b>
      {lead}
      {text ? <div className="admin-ordered-text">{text}</div> : label}
      <button type="button" data-action="remove" aria-label={`retirer ${name}`} disabled={disabled} onClick={onRemove}>
        ×
      </button>
    </li>
  )
}
