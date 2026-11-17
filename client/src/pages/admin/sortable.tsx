import { useRef } from 'react'
import type { ReactNode } from 'react'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { Announcements, ClientRect, CollisionDetection, KeyboardCoordinateGetter, Modifier, UniqueIdentifier } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { SortableHandle } from './use-sortable'

// Lists that are reordered by dragging their items by a handle, with a mouse, a finger or the keyboard, e.g. a set's
// performers (see "Reordering" in docs/design/client/admin/layout.md). Each item takes `useSortableItem`
// (use-sortable.ts), and has a `DragHandle`.

const INSTRUCTIONS = 'Espace ou Entrée pour saisir, flèches haut et bas pour déplacer, Espace ou Entrée pour déposer, Échap pour annuler.'

// The dragged item only moves up and down, and stays within its list, e.g. so that a table that scrolls sideways on
// phones doesn't grow when a row is dragged past its end.
const withinList: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) return { ...transform, x: 0 }
  const y = Math.min(Math.max(transform.y, containerNodeRect.top - draggingNodeRect.top), containerNodeRect.bottom - draggingNodeRect.bottom)
  return { ...transform, x: 0, y }
}
const MODIFIERS = [withinList]

// The places the dragged item is over, the closest first, by their heights only, since items can be of different widths,
// e.g. a collective's artists. Their tops or their bottoms are compared, whichever are closer, since items can be of
// different heights too, e.g. rows that wrap, and an item moved up takes the top of the place it takes, and one moved
// down its bottom.
const closestVertically: CollisionDetection = ({ collisionRect, droppableRects, droppableContainers }) => {
  const distance = (rect: ClientRect) => Math.min(Math.abs(rect.top - collisionRect.top), Math.abs(rect.bottom - collisionRect.bottom))
  return droppableContainers
    .flatMap((container) => {
      const rect = droppableRects.get(container.id)
      return rect ? [{ id: container.id, data: { droppableContainer: container, value: distance(rect) } }] : []
    })
    .sort((a, b) => a.data.value - b.data.value)
}

// Where the arrows move the dragged item: to the place after the one it's over, or before it, at the top of that place
// when it's moved up, or at its bottom when it's moved down, so that it's over that place (see `closestVertically`).
// dnd-kit's own `sortableKeyboardCoordinates` finds the next place by comparing corners, which skips places among items
// of different widths or heights.
const nextPlaceCoordinates: KeyboardCoordinateGetter = (event, { context: { active, over, collisionRect, droppableRects } }) => {
  const by = event.code === 'ArrowDown' ? 1 : event.code === 'ArrowUp' ? -1 : 0
  if (!by) return undefined
  // Rather than scrolling the page.
  event.preventDefault()
  const ids: UniqueIdentifier[] | undefined = active?.data.current?.sortable?.items
  if (!active || !collisionRect || !ids) return undefined
  const to = ids.indexOf(over?.id ?? active.id) + by
  const rect = droppableRects.get(ids[to])
  if (!rect) return undefined
  return { x: collisionRect.left, y: to > ids.indexOf(active.id) ? rect.bottom - collisionRect.height : rect.top }
}

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
      // `withinList`). The arrows still bring the place it's moved to into view.
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

// The handle that drags its item, at its start, named by `label`, e.g. "réordonner Aurore". Once it loses the focus, e.g.
// when something else is clicked, the item it's dragging with the keyboard is put back, as with Escape, rather than
// staying picked up, to be dropped by the next Space pressed elsewhere.
export function DragHandle({ handle: { ref, props, disabled }, label }: { handle: SortableHandle; label: string }) {
  return (
    <button
      type="button"
      ref={ref}
      className="admin-handle"
      aria-label={label}
      disabled={disabled}
      {...props}
      onBlur={(event) => {
        if (props['aria-pressed']) event.currentTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
      }}
    >
      {/* Six dots, in two columns. */}
      <svg aria-hidden="true" viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
        {[3, 8, 13].flatMap((y) => [2.5, 7.5].map((x) => <circle key={`${x},${y}`} cx={x} cy={y} r="1.5" />))}
      </svg>
    </button>
  )
}
