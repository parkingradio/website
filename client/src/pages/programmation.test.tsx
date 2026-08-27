import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Programmation } from './programmation'

describe('Programmation', () => {
  it('renders without crashing', () => {
    const { container } = render(<Programmation />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('links out to the Resident Advisor promoter page', () => {
    render(<Programmation />)
    expect(
      screen.getByRole('link', { name: 'Voir la programmation sur Resident Advisor' }),
    ).toHaveAttribute('href', 'https://ra.co/promoters/183980')
  })
})
