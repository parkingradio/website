import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent, TouchEvent } from 'react'
import { useDndContext } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'

// An item of a list that's reordered by dragging it by its handle (see sortable.tsx), e.g. an <li> or a <tr>: what the
// item takes, and its handle, for `DragHandle`. The library that does it, dnd-kit, is only used here, in sortable.tsx and
// in sortable-places.ts.

// What a handle takes, from the item it moves.
export type SortableHandle = {
  ref: (element: HTMLElement | null) => void
  // Its description, which says how to use it with the keyboard, and whether its item is picked up.
  props: {
    'aria-describedby': string
    'aria-pressed': boolean | undefined
    onKeyDown?: (event: ReactKeyboardEvent) => void
    onMouseDown?: (event: MouseEvent) => void
    onTouchStart?: (event: TouchEvent) => void
    onBlur?: () => void
  }
  // While its list can't be reordered (see `SortableList`).
  disabled: boolean
}

export function useSortableItem(id: string): { ref: (element: HTMLElement | null) => void; style: CSSProperties; dragging: boolean; handle: SortableHandle } {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  // Once the handle loses the focus, the item it's dragging with the keyboard is put back, as with Escape, which dnd-kit
  // listens for on the document, rather than staying picked up, to be dropped by the next Space pressed elsewhere.
  const { activatorEvent } = useDndContext()
  const putBack = isDragging && activatorEvent instanceof KeyboardEvent ? () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' })) : undefined
  return {
    ref: setNodeRef,
    // Items only move up and down (see `SortableList`), and the others move as they make room, rather than jumping.
    style: { transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition },
    dragging: isDragging,
    handle: {
      ref: setActivatorNodeRef,
      // Not dnd-kit's other attributes, which the handle, a button, has already, but for its role description, which is
      // English.
      props: { 'aria-describedby': attributes['aria-describedby'], 'aria-pressed': attributes['aria-pressed'], ...listeners, onBlur: putBack },
      disabled: attributes['aria-disabled'],
    },
  }
}

// Whether an item of the list it's rendered in is being dragged, e.g. to hide what the move changes until it's dropped.
export const useSorting = (): boolean => useDndContext().active !== null

export { arrayMove } from '@dnd-kit/sortable'
