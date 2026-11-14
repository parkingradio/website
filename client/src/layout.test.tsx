import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useNavigate } from 'react-router'
import App from './app'
import { CONFIG, mockFetch } from './test-utils'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  return screen.getByRole('button', { name: 'menu' })
}

// The menu only shows on narrow screens, which jsdom doesn't lay out, so these tests check the menu
// button's aria-expanded, which is set from the same state as the menu's visibility.
describe('Layout menu', () => {
  it('starts closed and toggles when the menu button is clicked', () => {
    const button = renderAt('/')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'nav-links')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes after navigating to another page', () => {
    const button = renderAt('/')
    fireEvent.click(button)

    const archives = screen.getByRole('link', { name: 'archives' })
    fireEvent.click(archives)
    expect(archives).toHaveClass('active')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes when a link to the current page is clicked', () => {
    const button = renderAt('/archives')
    fireEvent.click(button)

    fireEvent.click(screen.getByRole('link', { name: 'archives' }))
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes when tapping outside the menu', () => {
    const button = renderAt('/')
    fireEvent.click(button)

    // jsdom doesn't hit-test, so click the backdrop covering the page directly.
    fireEvent.click(document.querySelector('.menu-backdrop')!)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape and gives focus back to the menu button', () => {
    const button = renderAt('/')
    fireEvent.click(button)

    const link = screen.getByRole('link', { name: 'programmation' })
    link.focus()
    fireEvent.keyDown(link, { key: 'Escape' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
  })
})

describe('Layout scrolling', () => {
  it('opens another page at its top, but not the page that is already shown', () => {
    renderAt('/')

    fireEvent.click(screen.getByRole('link', { name: 'archives' }))
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith(0, 0)

    vi.mocked(window.scrollTo).mockClear()
    fireEvent.click(screen.getByRole('link', { name: 'archives' }))
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('leaves the page where the browser puts it when going back', () => {
    function Back() {
      const navigate = useNavigate()
      return <button onClick={() => navigate(-1)}>back</button>
    }
    render(
      <MemoryRouter initialEntries={['/', '/archives']} initialIndex={1}>
        <App />
        <Back />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByRole('link', { name: 'archives' })).not.toHaveClass('active')
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})

describe('Layout environment', () => {
  // So that each test sees the title the layout gives, rather than the one a previous test left.
  beforeEach(() => {
    document.title = ''
  })

  // The bar's links and buttons are in lowercase: only a stamp is in capitals.
  const stamp = () => within(screen.getByRole('navigation')).queryByText(/^[A-Z]+$/)

  it('stamps the navigation bar and the title outside production', async () => {
    mockFetch({ '/api/config': { ...CONFIG, environment: 'test' } })
    renderAt('/')

    const navigationBar = within(screen.getByRole('navigation'))
    expect(await navigationBar.findByText('TEST')).toBeInTheDocument()
    // The title is set by an effect, which React can run after the stamp shows.
    await waitFor(() => expect(document.title).toBe('[TEST] parking.radio'))
    // The logo's link keeps its name.
    expect(navigationBar.getAllByRole('link', { name: 'parking.radio' })).toHaveLength(2)
  })

  it('says nothing in production', async () => {
    // mockFetch's configuration is production's.
    renderAt('/')

    // The logo's image has its URL once the configuration has been fetched.
    await waitFor(() => expect(screen.getByAltText('parking.radio')).toHaveAttribute('src'))
    expect(stamp()).toBeNull()
    expect(document.title).toBe('parking.radio')
  })

  it("says nothing when the configuration can't be fetched", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch({ '/api/config': { ok: false, error: 'Boom' } })
    renderAt('/')

    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(stamp()).toBeNull()
    expect(document.title).toBe('parking.radio')
  })
})
