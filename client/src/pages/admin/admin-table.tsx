import { useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps } from 'react'

// A table of the admin pages, which every one of them is, so that it scrolls sideways when it's too wide for its space,
// with a shadow on each side that has more of it (see `.admin-table-frame` in admin.css).
export function AdminTable({ className, ...props }: ComponentProps<'table'>) {
  const scroller = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const [before, setBefore] = useState(false)
  const [after, setAfter] = useState(false)

  // Measured before the first paint, then whenever it's scrolled, or the scroller or the table changes size, e.g. once
  // rows are added. Within a pixel of an end counts as at it, since scrolling can stop a fraction of a pixel away.
  useLayoutEffect(() => {
    const element = scroller.current!
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = element
      setBefore(scrollLeft > 1)
      setAfter(scrollLeft + clientWidth < scrollWidth - 1)
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    observer.observe(table.current!)
    return () => {
      element.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  return (
    <div className="admin-table-frame" data-more-before={before || undefined} data-more-after={after || undefined}>
      <div ref={scroller} className="admin-table-scroll">
        <table ref={table} className={className ? `admin-table ${className}` : 'admin-table'} {...props} />
      </div>
    </div>
  )
}
