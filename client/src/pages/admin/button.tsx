import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, MouseEvent, PointerEvent } from 'react'

// A button of the admin pages, which can have a tooltip, `tip`, a sentence per line, or be greyed out, `unavailable`
// saying why in its tooltip (see "Tooltips" and "Controls that can't be used" in docs/design/client/admin/layout.md).
// A greyed-out button is only aria-disabled, so that it keeps the focus and its tooltip can be read. Clicking a button
// with a tooltip does nothing, except that tapping it toggles the tooltip, which is why only buttons that do nothing
// else when clicked have one.
export function Button({
  tip,
  unavailable,
  type = 'button',
  disabled,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tip?: string | readonly string[]
  // Why the button can't be used, or null when it can. It then ignores `disabled`, e.g. while a change is saved, so
  // that it keeps the focus and its tooltip.
  unavailable?: string | null
}) {
  const lines = unavailable ? [unavailable] : typeof tip === 'string' ? [tip] : (tip ?? [])
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLSpanElement>(null)
  // Why the tooltip shows: the button is hovered with a mouse, has the keyboard's focus, or was tapped.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const shown = lines.length > 0 && (hovered || focused || pinned)
  // Whether the click that comes is a tap, with a finger or a pen, rather than a mouse's click or the keyboard's.
  const tapping = useRef(false)
  // What it says, which changes its size, and so where it goes.
  const text = lines.join('\n')

  useLayoutEffect(() => {
    if (!shown) return
    // Under the button, without a gap, so that the pointer can move onto it, or above it when there's no room below,
    // within the page's width, less a 16px gutter on each side.
    const place = () => {
      const { top, bottom, left } = button.current!.getBoundingClientRect()
      const { offsetWidth: width, offsetHeight: height, style } = tooltip.current!
      const { clientWidth, clientHeight } = document.documentElement
      style.top = `${bottom + height <= clientHeight || top < height ? bottom : top - height}px`
      style.left = `${Math.max(16, Math.min(left, clientWidth - 16 - width))}px`
    }
    place()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setHovered(false)
      setFocused(false)
      setPinned(false)
    }
    // Tapping something else hides it, since tapping a button doesn't focus it in every browser.
    const onPointerDown = (event: Event) => {
      if (!anchor.current!.contains(event.target as Node)) setPinned(false)
    }
    const controller = new AbortController()
    const { signal } = controller
    // It follows the button as the page scrolls, and so does any table that overflows, whose scrolling doesn't bubble.
    window.addEventListener('scroll', place, { capture: true, signal })
    window.addEventListener('resize', place, { signal })
    document.addEventListener('keydown', onKeyDown, { signal })
    document.addEventListener('pointerdown', onPointerDown, { signal })
    return () => controller.abort()
  }, [shown, text])

  // Only a mouse hovers: touch screens send pointer events too, as a tap starts.
  const hover = (hovered: boolean) => (event: PointerEvent) => {
    if (event.pointerType === 'mouse') setHovered(hovered)
  }
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (lines.length === 0) return onClick?.(event)
    event.preventDefault()
    if (tapping.current) setPinned((pinned) => !pinned)
    tapping.current = false
  }
  // The same elements whether there's a tooltip or not, so that the button keeps the focus when it comes or goes.
  return (
    <span ref={anchor} onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
      <button
        {...props}
        ref={button}
        type={type}
        disabled={unavailable ? undefined : disabled}
        aria-disabled={unavailable ? true : undefined}
        aria-describedby={lines.length > 0 ? id : undefined}
        onPointerDown={(event) => (tapping.current = event.pointerType !== 'mouse')}
        onClick={click}
        // Only the keyboard's focus shows it, since browsers also focus a button when it's clicked or tapped.
        onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => {
          setFocused(false)
          setPinned(false)
        }}
      />
      {lines.length > 0 && (
        // Hidden rather than left out, so that it's the button's description for screen readers, where a space keeps
        // the lines' sentences apart.
        <span ref={tooltip} id={id} role="tooltip" className="admin-tooltip" hidden={!shown}>
          {lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && ' '}
              <span>{line}</span>
            </Fragment>
          ))}
        </span>
      )}
    </span>
  )
}
