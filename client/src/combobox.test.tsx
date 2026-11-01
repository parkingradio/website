import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Combobox } from './combobox'
import type { ComboboxOption } from './combobox'

const OPTIONS: ComboboxOption[] = [
  { key: 'a', label: 'Aurore' },
  { key: 'b', label: 'Brise', disabled: true },
  { key: 'c', label: 'Cyan' },
  { key: 'd', label: 'Dora' },
  { key: 'e', label: 'Ubel' },
]

// A combobox where only an option can be picked, which says what was picked.
function Strict({ options = OPTIONS, initial = null }: { options?: ComboboxOption[]; initial?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initial)
  return (
    <>
      <Combobox id="strict" options={options} selected={selected} onSelect={setSelected} />
      <output>{selected}</output>
    </>
  )
}

// A combobox where what's typed is the answer, and the options are suggestions.
function Text() {
  const [value, setValue] = useState('')
  return (
    <>
      <Combobox id="text" options={OPTIONS} text={{ value, onChange: setValue }} />
      <output>{value}</output>
    </>
  )
}

const input = () => screen.getByRole('combobox')
const option = (name: string) => screen.getByRole('option', { name })
// What the highlighted option says, if one is.
const active = () => document.getElementById(input().getAttribute('aria-activedescendant') ?? '')?.textContent ?? null
const picked = () => screen.getByRole('status').textContent
// The mouse moving over an option, to somewhere it wasn't.
let mouseX = 0
const hover = (name: string) => fireEvent.mouseMove(option(name), { screenX: ++mouseX, screenY: 10 })

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('Combobox', () => {
  it('highlights the option under the mouse, from which Enter and the arrow keys go on', () => {
    render(<Strict />)
    fireEvent.click(input())
    expect(active()).toBe('Aurore')

    hover('Cyan')
    expect(active()).toBe('Cyan')
    expect(option('Cyan')).toHaveAttribute('aria-selected', 'true')
    expect(option('Aurore')).toHaveAttribute('aria-selected', 'false')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(active()).toBe('Dora')
    hover('Cyan')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(picked()).toBe('c')
  })

  it('scrolls to the option the keyboard highlights, but not to the one under the mouse', () => {
    render(<Strict />)
    fireEvent.click(input())
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    hover('Cyan')
    // Again over the same option, which doesn't change anything.
    hover('Cyan')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(option('Dora'))
  })

  it('scrolls to the option picked when the list opens', () => {
    render(<Strict initial="d" />)
    fireEvent.click(input())
    expect(active()).toBe('Dora')
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toEqual([option('Dora')])
  })

  it("ignores the mouse when it hasn't moved, as when the list scrolls under it", () => {
    render(<Strict />)
    fireEvent.click(input())
    fireEvent.mouseMove(option('Cyan'), { screenX: 5, screenY: 5 })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(active()).toBe('Dora')
    fireEvent.mouseMove(option('Aurore'), { screenX: 5, screenY: 5 })
    expect(active()).toBe('Dora')
  })

  it('picks nothing when the field is left after hovering an option', () => {
    render(<Strict />)
    fireEvent.click(input())
    hover('Cyan')
    fireEvent.blur(input())
    expect(picked()).toBe('')
    expect(input()).toHaveAttribute('aria-expanded', 'false')
  })

  it('with suggestions, picks nothing when the field is left after hovering one, and typing again forgets it', () => {
    render(<Text />)
    fireEvent.change(input(), { target: { value: 'r' } })
    expect(active()).toBeNull()
    hover('Aurore')
    expect(active()).toBe('Aurore')
    fireEvent.change(input(), { target: { value: 'ra' } })
    expect(active()).toBeNull()

    hover('Dora')
    fireEvent.blur(input())
    expect(picked()).toBe('ra')
  })

  it("shows options that can't be picked, which the mouse and the arrow keys skip", () => {
    render(<Strict />)
    fireEvent.click(input())
    expect(option('Brise')).toHaveAttribute('aria-disabled', 'true')
    expect(option('Aurore')).not.toHaveAttribute('aria-disabled')

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(active()).toBe('Cyan')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(active()).toBe('Aurore')
    hover('Brise')
    expect(active()).toBe('Aurore')
    expect(option('Brise')).toHaveAttribute('aria-selected', 'false')

    // Clicking it leaves the list as it is.
    fireEvent.mouseDown(option('Brise'))
    expect(picked()).toBe('')
    expect(input()).toHaveAttribute('aria-expanded', 'true')
  })

  it('highlights the first option that can be picked, and none when none can, when Enter picks nothing', () => {
    render(<Strict />)
    fireEvent.change(input(), { target: { value: 'b' } })
    // "Brise" first, since it starts with what's typed.
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Brise', 'Ubel'])
    expect(active()).toBe('Ubel')

    fireEvent.change(input(), { target: { value: 'bri' } })
    expect(active()).toBeNull()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(active()).toBeNull()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(picked()).toBe('')
    expect(input()).toHaveAttribute('aria-expanded', 'false')
  })

  it("starts from the first option that can be picked when the one picked can't be anymore", () => {
    render(<Strict initial="b" />)
    fireEvent.click(input())
    expect(active()).toBe('Aurore')
  })
})
