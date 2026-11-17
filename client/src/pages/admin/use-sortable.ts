import type { CSSProperties, KeyboardEvent, MouseEvent, TouchEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'

// An item of a list that's reordered by dragging it by its handle (see sortable.tsx), e.g. an <li> or a <tr>: what the
// item takes, and its handle, for `DragHandle`. The library that does it, dnd-kit, is only used here and in
// sortable.tsx.

// What a handle takes, from the item it moves.
export type SortableHandle = {
  ref: (element: HTMLElement | null) => void
  // Its description, which says how to use it with the keyboard, and whether its item is picked up.
  props: {
    'aria-describedby': string
    'aria-pressed': boolean | undefined
    onKeyDown?: (event: KeyboardEvent) => void
    onMouseDown?: (event: MouseEvent) => void
    onTouchStart?: (event: TouchEvent) => void
  }
  // While its list can't be reordered (see `SortableList`).
  disabled: boolean
}

export function useSortableItem(id: string): { ref: (element: HTMLElement | null) => void; style: CSSProperties; dragging: boolean; handle: SortableHandle } {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return {
    ref: setNodeRef,
    // Items only move up and down (see `SortableList`), and the others move as they make room, rather than jumping.
    style: { transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition },
    dragging: isDragging,
    handle: {
      ref: setActivatorNodeRef,
      // Not dnd-kit's other attributes, which the handle, a button, has already, but for its role description, which is
      // English.
      props: { 'aria-describedby': attributes['aria-describedby'], 'aria-pressed': attributes['aria-pressed'], ...listeners },
      disabled: attributes['aria-disabled'],
    },
  }
}

export { arrayMove } from '@dnd-kit/sortable'
