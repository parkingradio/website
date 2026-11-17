import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ClientRect } from '@dnd-kit/core'
import { mockListLayout, moveWithKeyboard } from '../../test-utils'
import { DragHandle, SortableList } from './sortable'
import { closestVertically } from './sortable-places'
import { arrayMove, useSortableItem } from './use-sortable'

// A list of A, B, C and D, reordered by their handles, unless it's `disabled`, and a button outside it. `onMove` is told
// of each move.
function Letters({ onMove, disabled }: { onMove: (from: number, to: number) => void; disabled?: boolean }) {
  const [letters, setLetters] = useState(['A', 'B', 'C', 'D'])
  return (
    <>
      <SortableList
        ids={letters}
        nameOf={(index) => letters[index]}
        disabled={disabled}
        onMove={(from, to) => {
          onMove(from, to)
          setLetters(arrayMove(letters, from, to))
        }}
      >
        <ol>
          {letters.map((letter) => (
            <Letter key={letter} letter={letter} />
          ))}
        </ol>
      </SortableList>
      <button type="button">ailleurs</button>
    </>
  )
}

function Letter({ letter }: { letter: string }) {
  const { ref, style, handle } = useSortableItem(letter)
  return (
    <li ref={ref} style={style}>
      <DragHandle handle={handle} label={`réordonner ${letter}`} />
      {letter}
    </li>
  )
}

const handle = (letter: string) => screen.getByRole('button', { name: `réordonner ${letter}` })
const letters = () => screen.getAllByRole('listitem').map((item) => item.textContent)

describe('A list reordered by dragging', () => {
  it('moves an item once, when it is dropped somewhere else', async () => {
    const onMove = vi.fn()
    render(<Letters onMove={onMove} />)

    await moveWithKeyboard(handle('A'), 2)
    expect(onMove).toHaveBeenCalledOnce()
    expect(onMove).toHaveBeenCalledWith(0, 2)
    expect(letters()).toEqual(['B', 'C', 'A', 'D'])

    // Put back, or dropped where it was.
    await moveWithKeyboard(handle('D'), -2, { cancel: true })
    await moveWithKeyboard(handle('B'), 0)
    expect(onMove).toHaveBeenCalledOnce()
    expect(letters()).toEqual(['B', 'C', 'A', 'D'])
  })

  it('moves an item one place at a time with the arrows, whatever the widths of the others', async () => {
    const onMove = vi.fn()
    render(<Letters onMove={onMove} />)

    await moveWithKeyboard(handle('A'), 1, { layout: { widths: [300, 100, 300, 100] } })
    expect(onMove).toHaveBeenCalledWith(0, 1)
    await moveWithKeyboard(handle('A'), 1, { layout: { widths: [100, 300, 100, 300] } })
    expect(onMove).toHaveBeenLastCalledWith(1, 2)
  })

  it('moves an item taller than the others to the first place and to the last', async () => {
    const onMove = vi.fn()
    render(<Letters onMove={onMove} />)

    await moveWithKeyboard(handle('D'), -3, { layout: { heights: [40, 40, 40, 88] } })
    expect(onMove).toHaveBeenCalledWith(3, 0)
    expect(letters()).toEqual(['D', 'A', 'B', 'C'])
    await moveWithKeyboard(handle('D'), 3, { layout: { heights: [88, 40, 40, 40] } })
    expect(onMove).toHaveBeenLastCalledWith(0, 3)
    expect(letters()).toEqual(['A', 'B', 'C', 'D'])
    // Exactly twice as tall, which lines it up with two places at once.
    await moveWithKeyboard(handle('A'), 3, { layout: { heights: [80, 40, 40, 40] } })
    expect(onMove).toHaveBeenLastCalledWith(0, 3)
    await moveWithKeyboard(handle('A'), -3, { layout: { heights: [40, 40, 40, 80] } })
    expect(onMove).toHaveBeenLastCalledWith(3, 0)
    expect(letters()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('puts the dragged item over places further along as it goes further, whatever its height', () => {
    // A row twice as tall as the others, but for 4px, B, dragged a pixel at a time from the top of the list to its bottom.
    const heights = { A: 36, B: 76, C: 36, D: 36, E: 36 }
    const rects = new Map<string, ClientRect>()
    let top = 0
    for (const [id, height] of Object.entries(heights)) {
      rects.set(id, { top, bottom: top + height, left: 0, right: 800, width: 800, height })
      top += height
    }
    const over = (dy: number) => {
      const collisionRect = { top: 36 + dy, bottom: 112 + dy, left: 0, right: 800, width: 800, height: 76 }
      const args = { active: { id: 'B' }, collisionRect, droppableRects: rects, droppableContainers: [...rects.keys()].map((id) => ({ id })) }
      return closestVertically(args as unknown as Parameters<typeof closestVertically>[0])[0].id
    }
    const overs = Array.from({ length: 36 + 108 + 1 }, (_, i) => over(i - 36))
    // In order, each once, however it's swept.
    expect(overs.filter((id, i) => id !== overs[i - 1])).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it("doesn't scroll the page sideways while an item is dragged with the keyboard", async () => {
    render(<Letters onMove={() => {}} />)
    mockListLayout()

    handle('A').focus()
    fireEvent.keyDown(handle('A'), { key: ' ', code: 'Space' })
    await act(() => new Promise((resolve) => setTimeout(resolve)))
    for (const code of ['ArrowRight', 'ArrowLeft', 'PageDown', 'End']) expect(fireEvent.keyDown(handle('A'), { key: code, code })).toBe(false)
    fireEvent.keyDown(handle('A'), { key: 'Escape', code: 'Escape' })
  })

  it('puts the item back when its handle loses the focus, so that keys pressed elsewhere do not drop it', async () => {
    const onMove = vi.fn()
    render(<Letters onMove={onMove} />)
    mockListLayout()

    handle('A').focus()
    fireEvent.keyDown(handle('A'), { key: ' ', code: 'Space' })
    await act(() => new Promise((resolve) => setTimeout(resolve)))
    fireEvent.keyDown(handle('A'), { key: 'ArrowDown', code: 'ArrowDown' })
    expect(handle('A')).toHaveAttribute('aria-pressed', 'true')
    const elsewhere = screen.getByRole('button', { name: 'ailleurs' })
    act(() => elsewhere.focus())
    expect(handle('A')).not.toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(elsewhere, { key: ' ', code: 'Space' })
    await act(() => new Promise((resolve) => setTimeout(resolve)))
    expect(onMove).not.toHaveBeenCalled()
    expect(letters()).toEqual(['A', 'B', 'C', 'D'])
  })

  it("can't be reordered while it's disabled, with the mouse, a finger or the keyboard, but its handles keep the focus", async () => {
    const onMove = vi.fn()
    const { rerender } = render(<Letters onMove={onMove} disabled />)
    mockListLayout()
    // A finger held on the handle for longer than it takes to pick its item up, then lifted.
    const touch = async (letter: string) => {
      fireEvent.touchStart(handle(letter), { touches: [{ clientX: 10, clientY: 20 }] })
      await act(() => new Promise((resolve) => setTimeout(resolve, 250)))
      const pickedUp = handle(letter).getAttribute('aria-pressed') === 'true'
      fireEvent.touchEnd(handle(letter), { touches: [] })
      return pickedUp
    }

    expect(handle('A')).toHaveAttribute('aria-disabled', 'true')
    handle('A').focus()
    expect(handle('A')).toHaveFocus()
    await moveWithKeyboard(handle('A'), 2)
    expect(handle('A')).toHaveFocus()
    fireEvent.mouseDown(handle('B'), { button: 0, clientX: 10, clientY: 60 })
    fireEvent.mouseMove(document, { clientX: 10, clientY: 100 })
    expect(handle('B')).not.toHaveAttribute('aria-pressed', 'true')
    fireEvent.mouseUp(document, { clientX: 10, clientY: 100 })
    expect(await touch('C')).toBe(false)
    expect(onMove).not.toHaveBeenCalled()
    expect(letters()).toEqual(['A', 'B', 'C', 'D'])

    // Unlike once it's enabled again.
    rerender(<Letters onMove={onMove} />)
    expect(handle('A')).not.toHaveAttribute('aria-disabled')
    expect(await touch('C')).toBe(true)
  })

  it('keeps dragging an item with the mouse when its handle loses the focus, e.g. to another window', () => {
    render(<Letters onMove={() => {}} />)
    mockListLayout()

    handle('A').focus()
    fireEvent.mouseDown(handle('A'), { button: 0, clientX: 10, clientY: 20 })
    fireEvent.mouseMove(document, { clientX: 10, clientY: 40 })
    expect(handle('A')).toHaveAttribute('aria-pressed', 'true')
    act(() => handle('A').blur())
    expect(handle('A')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.mouseUp(document, { clientX: 10, clientY: 40 })
  })
})
