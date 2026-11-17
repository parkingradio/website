import { useRef } from 'react'
import type { ReactNode } from 'react'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { Announcements } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { closestVertically, nextPlaceCoordinates, withinList } from './sortable-places'
import type { SortableHandle } from './use-sortable'

// Lists that are reordered by dragging their items by a handle, with a mouse, a finger or the keyboard, e.g. a set's
// performers (see "Reordering" in docs/design/client/admin/layout.md). Each item takes `useSortableItem`
// (use-sortable.ts), and has a `DragHandle`.

const INSTRUCTIONS = 'Espace ou Entrée pour saisir, flèches haut et bas pour déplacer, Espace ou Entrée pour déposer, Échap pour annuler.'
const MODIFIERS = [withinList]

// The list, e.g. an <ol> or a whole <table>, but not its <tbody>, since what screen readers read is rendered after it.
// The items, by their `ids` in their order, are named by `nameOf`, from their index, in what screen readers announce.
// `onMove` moves the item at `from` to `to`, once it's dropped there, and only if it's another place. While `disabled`,
// e.g. while the list is sent, its items can't be dragged.
export function SortableList({
  ids,
  nameOf,
  disabled = false,
  onMove,
  children,
}: {
  ids: string[]
  nameOf: (index: number) => string
  disabled?: boolean
  onMove: (from: number, to: number) => void
  children: ReactNode
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Touch screens wait for the handle to be held for a moment, so that brushing it while scrolling does nothing (which
    // e2e/tests/drag.ts waits for too).
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: nextPlaceCoordinates }),
  )

  // dnd-kit says the item is over its own place as soon as it's picked up, which would cut what's announced then.
  const pickedUp = useRef(false)
  const name = (id: string | number) => nameOf(ids.indexOf(String(id)))
  const place = (id: string | number) => `position ${ids.indexOf(String(id)) + 1} sur ${ids.length}`
  const announcements: Announcements = {
    onDragStart({ active }) {
      pickedUp.current = true
      return `Vous déplacez ${name(active.id)} en ${place(active.id)}.`
    },
    onDragOver({ active, over }) {
      if (!over || (pickedUp.current && over.id === active.id)) return
      pickedUp.current = false
      return `${name(active.id)}\u00a0: ${place(over.id)}.`
    },
    onDragEnd({ active, over }) {
      if (over && over.id !== active.id) return `${name(active.id)} est maintenant en ${place(over.id)}.`
      return `${name(active.id)} reste en ${place(active.id)}.`
    },
    onDragCancel({ active }) {
      return `Déplacement annulé\u00a0: ${name(active.id)} reste en ${place(active.id)}.`
    },
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestVertically}
      modifiers={MODIFIERS}
      // The lists are short, and the page scrolling under the dragged item would take it past their ends (see
      // `withinList` in sortable-places.ts). The arrows still bring the place it's moved to into view.
      autoScroll={false}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
      onDragEnd={({ active, over }) => {
        const from = ids.indexOf(String(active.id))
        const to = over ? ids.indexOf(String(over.id)) : from
        if (from !== to) onMove(from, to)
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

// The handle that drags its item, at its start, named by `label`, e.g. "réordonner Aurore". While its list can't be
// reordered, it's only aria-disabled, so that it keeps the focus, e.g. once its item is dropped and the move is saved
// (see "A session's page" in docs/design/client/admin/sessions.md): dnd-kit then drops its listeners.
export function DragHandle({ handle: { ref, props, disabled }, label }: { handle: SortableHandle; label: string }) {
  return (
    <button type="button" ref={ref} className="admin-handle" aria-label={label} aria-disabled={disabled || undefined} {...props}>
      {/* Six dots, in two columns. */}
      <svg aria-hidden="true" viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
        {[3, 8, 13].flatMap((y) => [2.5, 7.5].map((x) => <circle key={`${x},${y}`} cx={x} cy={y} r="1.5" />))}
      </svg>
    </button>
  )
}
