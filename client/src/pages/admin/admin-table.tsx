import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps } from 'react'

// A table of the admin pages, which every one of them is, so that on phones it scrolls sideways when it's too wide for
// the screen, with a shadow on each side that has more of it (see `.admin-table-frame` in admin.css). The sides are
// measured at every width, but the shadows are only drawn on phones.
export function AdminTable({ className, ...props }: ComponentProps<'table'>) {
  const scroller = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const [before, setBefore] = useState(false)
  const [after, setAfter] = useState(false)

  // Within a pixel of an end counts as at it, since scrolling can stop a fraction of a pixel away.
  const update = useCallback(() => {
    const { scrollLeft, scrollWidth, clientWidth } = scroller.current!
    setBefore(scrollLeft > 1)
    setAfter(scrollLeft + clientWidth < scrollWidth - 1)
  }, [])

  // Measured before the first paint, then whenever it's scrolled (see `onScroll`), or the scroller or the table changes
  // size, e.g. once rows are added.
  useLayoutEffect(() => {
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroller.current!)
    observer.observe(table.current!)
    return () => observer.disconnect()
  }, [update])

  return (
    <div className="admin-table-frame" data-more-before={before || undefined} data-more-after={after || undefined}>
      <div ref={scroller} className="admin-table-scroll" onScroll={update}>
        <table ref={table} className={className ? `admin-table ${className}` : 'admin-table'} {...props} />
      </div>
    </div>
  )
}
