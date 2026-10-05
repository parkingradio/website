import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { NotFound } from './not-found'

describe('NotFound', () => {
  it('says the page does not exist and links back to the home page', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "retour à l'accueil" })).toHaveAttribute('href', '/')
  })
})
