import { render, screen } from '@testing-library/react'
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

  it('renders /accept-invite without crashing', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/accept-invite?token=abc']}>
        <App />
      </MemoryRouter>,
    )
    expect(container).not.toBeEmptyDOMElement()
  })
})
