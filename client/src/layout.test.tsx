import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import App from './app'

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
