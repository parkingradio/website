import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import App from './app'

describe('App', () => {
  it('renders the home page at /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByTitle('Parking Radio')).toBeInTheDocument()
  })

  it('renders the navbar with links to every page', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'archives' })).toHaveAttribute('href', '/archives')
    expect(screen.getByRole('link', { name: 'programmation' })).toHaveAttribute(
      'href',
      '/programmation',
    )
    expect(screen.getByRole('link', { name: 'synth meetups' })).toHaveAttribute(
      'href',
      '/synth-meetups',
    )
    expect(screen.getByRole('link', { name: 'appliquer' })).toHaveAttribute('href', '/appliquer')
    expect(screen.getByRole('link', { name: 'contribuer' })).toHaveAttribute('href', '/contribuer')
    expect(screen.getByRole('link', { name: 'merch' })).toHaveAttribute(
      'href',
      'https://parkingdotradio.bigcartel.com',
    )
  })

  it('renders the rotating logo, linking back to the home page', async () => {
    render(
      <MemoryRouter initialEntries={['/archives']}>
        <App />
      </MemoryRouter>,
    )
    const logo = screen.getByAltText('parking.radio')
    expect(logo.closest('a')).toHaveAttribute('href', '/')

    // The logo renders before /api/config resolves, so its src only appears once it has.
    expect(logo).not.toHaveAttribute('src')
    await waitFor(() =>
      expect(logo).toHaveAttribute('src', 'https://assets.example.test/p_3d_spin.gif'),
    )
  })

  it('renders /accept-invite without crashing', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/accept-invite?token=abc']}>
        <App />
      </MemoryRouter>,
    )
    expect(container).not.toBeEmptyDOMElement()
  })
})
