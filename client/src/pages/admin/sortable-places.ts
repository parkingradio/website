import type { ClientRect, CollisionDetection, KeyboardCoordinateGetter, Modifier, UniqueIdentifier } from '@dnd-kit/core'

// Where the item dragged in a list goes (see sortable.tsx): the places it's over, and the next one with the arrows.
// Items can be of different widths, e.g. a collective's artists, and of different heights, e.g. rows that wrap.

// The dragged item only moves up and down, and stays within its list, e.g. so that a table that scrolls sideways on
// phones doesn't grow when a row is dragged past its end.
export const withinList: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) return { ...transform, x: 0 }
  const y = Math.min(Math.max(transform.y, containerNodeRect.top - draggingNodeRect.top), containerNodeRect.bottom - draggingNodeRect.bottom)
  return { ...transform, x: 0, y }
}

// The places the dragged item is over, the closest first, by their heights only. The item takes the top of a place before
// its own, since the places from there to its own move down to make room, and the bottom of one after its own, so that's
// what's compared.
export const closestVertically: CollisionDetection = ({ active, collisionRect, droppableRects, droppableContainers }) => {
  const own = droppableRects.get(active.id)
  const distance = (rect: ClientRect) =>
    own && rect.top < own.top ? Math.abs(rect.top - collisionRect.top) : Math.abs(rect.bottom - collisionRect.bottom)
  return droppableContainers
    .flatMap((container) => {
      const rect = droppableRects.get(container.id)
      return rect ? [{ id: container.id, data: { droppableContainer: container, value: distance(rect) } }] : []
    })
    .sort((a, b) => a.data.value - b.data.value)
}

// The keys that would scroll the page under the item dragged with the keyboard, which do nothing then, rather than
// moving the page from under it.
const SCROLLING_KEYS = ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']

// Where the arrows move the dragged item: to the place before or after the one it's over, at the top of that place if
// it's before the item's own, or at its bottom if it's after it, so that it's over that place (see `closestVertically`).
// dnd-kit's own `sortableKeyboardCoordinates` finds the next place by comparing corners, which skips places among items
// of different widths or heights.
export const nextPlaceCoordinates: KeyboardCoordinateGetter = (event, { context: { active, over, collisionRect, droppableRects } }) => {
  const by = event.code === 'ArrowDown' ? 1 : event.code === 'ArrowUp' ? -1 : 0
  if (by === 0) {
    if (SCROLLING_KEYS.includes(event.code)) event.preventDefault()
    return undefined
  }
  event.preventDefault()
  const ids: UniqueIdentifier[] | undefined = active?.data.current?.sortable?.items
  if (!active || !collisionRect || !ids) return undefined
  const to = ids.indexOf(over?.id ?? active.id) + by
  const rect = droppableRects.get(ids[to])
  if (!rect) return undefined
  return { x: collisionRect.left, y: to > ids.indexOf(active.id) ? rect.bottom - collisionRect.height : rect.top }
}
