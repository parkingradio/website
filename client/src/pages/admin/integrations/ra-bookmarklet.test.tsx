import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfigContext } from '../../../config-context'
import { CONFIG } from '../../../test-utils'
import { RaBookmarklet } from './ra-bookmarklet'

describe('The bookmarklet that publishes on RA', () => {
  it('loads its code from this site each time', () => {
    render(<RaBookmarklet />)

    const link = screen.getByText('Parking Radio → RA')
    const href = link.getAttribute('href')!
    expect(href).toMatch(/^javascript:/)
    // Clicking it here does nothing: it's dragged to the bookmarks.
    expect(fireEvent.click(link)).toBe(false)
    new Function(decodeURIComponent(href.slice('javascript:'.length)))()
    const scripts = document.body.querySelectorAll('script')
    expect(scripts[scripts.length - 1].src).toMatch(new RegExp(`^${location.origin}/ra-bookmarklet\\.js\\?\\d+$`))
    scripts[scripts.length - 1].remove()
  })

  it('is named after the environment outside production, so that admins tell their bookmarks apart', () => {
    render(
      <ConfigContext value={{ kind: 'loaded', config: { ...CONFIG, environment: 'test' } }}>
        <RaBookmarklet />
      </ConfigContext>,
    )

    expect(screen.getByText('Parking Radio → RA [TEST]')).toHaveAttribute('href', expect.stringMatching(/^javascript:/))
  })
})
