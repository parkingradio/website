import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockListLayout, moveWithKeyboard } from '../../test-utils'
import { DragHandle, SortableList } from './sortable'
import { arrayMove, useSortableItem } from './use-sortable'

// A list of A, B, C and D, reordered by their handles, and a button outside it. `onMove` is told of each move.
function Letters({ onMove }: { onMove: (from: number, to: number) => void }) {
  const [letters, setLetters] = useState(['A', 'B', 'C', 'D'])
  return (
    <>
      <SortableList
        ids={letters}
        nameOf={(index) => letters[index]}
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
})
