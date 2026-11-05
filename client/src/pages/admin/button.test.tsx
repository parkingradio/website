import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'

const tooltip = () => screen.getByRole('tooltip', { hidden: true })

// Taps `element` with a finger, or clicks it with a mouse, as browsers send it.
function tap(element: HTMLElement, pointerType: 'touch' | 'mouse' = 'touch') {
  fireEvent.pointerDown(element, { pointerType })
  fireEvent.click(element)
}

// Focuses `element` as the keyboard does, which jsdom doesn't tell from a click's focus for `:focus-visible`.
function keyboardFocus(element: HTMLElement) {
  const matches = element.matches.bind(element)
  vi.spyOn(element, 'matches').mockImplementation((selectors) => selectors === ':focus-visible' || matches(selectors))
  act(() => element.focus())
}

describe('Button', () => {
  it('is a plain button without a tooltip', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>ajouter</Button>)
    const button = screen.getByRole('button', { name: 'ajouter' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      <Button onClick={onClick} disabled>
        ajouter
      </Button>,
    )
    expect(button).toBeDisabled()
  })

  it('describes the button with its tooltip, a sentence per line, kept apart', () => {
    render(<Button tip={['Finit après la session.', 'Chevauche le set de Cyan, 22 h – 23 h 30.']}>⚠</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveAccessibleDescription('Finit après la session. Chevauche le set de Cyan, 22 h – 23 h 30.')
    expect(tooltip()).not.toBeVisible()
  })

  it('shows its tooltip while a mouse hovers it, or its tooltip, but not as a tap starts', () => {
    render(<Button tip="Pourquoi.">⚠</Button>)
    const anchor = screen.getByRole('button').parentElement!
    fireEvent.pointerEnter(anchor, { pointerType: 'touch' })
    expect(tooltip()).not.toBeVisible()

    fireEvent.pointerEnter(anchor, { pointerType: 'mouse' })
    expect(tooltip()).toBeVisible()
    fireEvent.pointerLeave(anchor, { pointerType: 'mouse' })
    expect(tooltip()).not.toBeVisible()
  })

  it("shows its tooltip while it has the keyboard's focus, but not a click's", () => {
    render(<Button tip="Pourquoi.">⚠</Button>)
    const button = screen.getByRole('button')
    act(() => button.focus())
    expect(tooltip()).not.toBeVisible()
    act(() => button.blur())

    keyboardFocus(button)
    expect(tooltip()).toBeVisible()
    act(() => button.blur())
    expect(tooltip()).not.toBeVisible()
  })

  it('hides its tooltip on Escape, even while it is hovered and focused', () => {
    render(<Button tip="Pourquoi.">⚠</Button>)
    const button = screen.getByRole('button')
    fireEvent.pointerEnter(button.parentElement!, { pointerType: 'mouse' })
    keyboardFocus(button)
    expect(tooltip()).toBeVisible()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(tooltip()).not.toBeVisible()
    expect(button).toHaveFocus()
  })

  it('shows its tooltip once tapped, with a finger or a pen, until it is tapped again, or something else is, doing nothing else', () => {
    const onClick = vi.fn()
    render(
      <>
        <Button tip="Pourquoi." onClick={onClick}>
          ⚠
        </Button>
        <p>ailleurs</p>
      </>,
    )
    const button = screen.getByRole('button')
    // As Chrome does, tapping focuses the button, but not as the keyboard does.
    act(() => button.focus())
    tap(button)
    expect(tooltip()).toBeVisible()
    expect(button).toHaveFocus()
    tap(button)
    expect(tooltip()).not.toBeVisible()

    fireEvent.pointerDown(button, { pointerType: 'pen' })
    fireEvent.click(button)
    expect(tooltip()).toBeVisible()
    fireEvent.pointerDown(screen.getByText('ailleurs'))
    expect(tooltip()).not.toBeVisible()
    expect(onClick).not.toHaveBeenCalled()
  })

  it("doesn't show its tooltip when it's clicked with a mouse, or with the keyboard, doing nothing else", () => {
    const onClick = vi.fn()
    render(
      <Button tip="Pourquoi." onClick={onClick}>
        ⚠
      </Button>,
    )
    const button = screen.getByRole('button')
    tap(button, 'mouse')
    expect(tooltip()).not.toBeVisible()
    // Enter or Space, without a pointer.
    fireEvent.click(button)
    expect(tooltip()).not.toBeVisible()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps its tooltip when the tooltip itself is tapped, but not once the button loses the focus', () => {
    render(<Button tip="Pourquoi.">⚠</Button>)
    const button = screen.getByRole('button')
    act(() => button.focus())
    tap(button)
    fireEvent.pointerDown(tooltip())
    expect(tooltip()).toBeVisible()

    act(() => button.blur())
    expect(tooltip()).not.toBeVisible()
  })

  it('stops listening to the page once it is gone, even while its tooltip shows', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener')
    const { unmount } = render(<Button tip="Pourquoi.">⚠</Button>)
    tap(screen.getByRole('button'))
    const signals = addEventListener.mock.calls.flatMap(([, , options]) => (typeof options === 'object' && options.signal ? [options.signal] : []))
    expect(signals).not.toHaveLength(0)
    expect(signals.some((signal) => signal.aborted)).toBe(false)
    unmount()
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it("can't be used when it's unavailable, saying why, but keeps the focus, even while busy", () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <form onSubmit={onClick}>
        <Button type="submit" unavailable="La session est annulée." disabled onClick={onClick}>
          ajouter
        </Button>
      </form>,
    )
    const button = screen.getByRole('button', { name: 'ajouter' })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription('La session est annulée.')
    keyboardFocus(button)
    expect(button).toHaveFocus()
    expect(tooltip()).toBeVisible()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()

    // Once it can be used, it's the same button, which keeps the focus.
    rerender(
      <form onSubmit={(event) => event.preventDefault()}>
        <Button type="submit" unavailable={null} onClick={onClick}>
          ajouter
        </Button>
      </form>,
    )
    expect(button).toHaveFocus()
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button).not.toHaveAttribute('aria-describedby')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('places its tooltip under the button, within the page, or above it when there is no room below, as the page scrolls', () => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1024)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(768)
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(50)
    const { rerender } = render(<Button tip="Pourquoi.">⚠</Button>)
    const button = screen.getByRole('button')
    const at = (top: number, left: number) => vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, top, 20, 20))

    at(100, 900)
    tap(button)
    expect(tooltip()).toHaveStyle({ top: '120px', left: '808px' })

    // Placed again when what it says changes, and so its size.
    width.mockReturnValue(300)
    rerender(<Button tip="Pourquoi, plus longuement.">⚠</Button>)
    expect(tooltip()).toHaveStyle({ top: '120px', left: '708px' })

    at(740, 10)
    fireEvent.scroll(window)
    expect(tooltip()).toHaveStyle({ top: '690px', left: '16px' })
  })
})
