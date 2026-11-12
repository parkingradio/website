import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminTable } from './admin-table'

// jsdom doesn't lay anything out, so the scroller's sizes and position are made up, and the elements that a
// ResizeObserver observes are told that they changed size by `resized`.
let sizes = { scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }
let observed: Element[] = []
let resized = () => {}

beforeEach(() => {
  sizes = { scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }
  observed = []
  for (const name of ['scrollLeft', 'scrollWidth', 'clientWidth'] as const) {
    vi.spyOn(HTMLElement.prototype, name, 'get').mockImplementation(() => sizes[name])
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = () => act(callback)
      }
      observe(element: Element) {
        observed.push(element)
      }
      unobserve() {}
      disconnect() {}
    },
  )
})

function renderTable() {
  render(
    <AdminTable aria-label="Sets">
      <tbody>
        <tr>
          <td>Ondine</td>
        </tr>
      </tbody>
    </AdminTable>,
  )
  const table = screen.getByRole('table', { name: 'Sets' })
  const scroller = table.parentElement!
  const frame = scroller.parentElement!
  const scrollTo = (scrollLeft: number) => {
    sizes.scrollLeft = scrollLeft
    fireEvent.scroll(scroller)
  }
  const shadows = () => ({ before: frame.hasAttribute('data-more-before'), after: frame.hasAttribute('data-more-after') })
  return { table, scroller, scrollTo, shadows }
}

describe('AdminTable', () => {
  it('is a table of the admin pages, with its own class too', () => {
    const { table } = renderTable()
    expect(table).toHaveClass('admin-table')
    cleanup()
    render(<AdminTable className="admin-table-controls" aria-label="Sets" />)
    expect(screen.getByRole('table', { name: 'Sets' })).toHaveClass('admin-table', 'admin-table-controls')
  })

  it('has no shadow when the table fits', () => {
    const { shadows } = renderTable()
    expect(shadows()).toEqual({ before: false, after: false })
  })

  it('has a shadow on each side that has more of the table, as it scrolls', () => {
    sizes.scrollWidth = 500
    const { scrollTo, shadows } = renderTable()
    expect(shadows()).toEqual({ before: false, after: true })
    scrollTo(100)
    expect(shadows()).toEqual({ before: true, after: true })
    scrollTo(200)
    expect(shadows()).toEqual({ before: true, after: false })
  })

  it('counts within a pixel of an end as at it', () => {
    sizes.scrollWidth = 500
    const { scrollTo, shadows } = renderTable()
    scrollTo(0.5)
    expect(shadows()).toEqual({ before: false, after: true })
    scrollTo(199.5)
    expect(shadows()).toEqual({ before: true, after: false })
  })

  it('follows the table and the scroller when they change size', () => {
    const { table, scroller, shadows } = renderTable()
    expect(observed).toEqual([scroller, table])
    sizes.scrollWidth = 500
    resized()
    expect(shadows()).toEqual({ before: false, after: true })
    sizes.clientWidth = 500
    resized()
    expect(shadows()).toEqual({ before: false, after: false })
  })
})
