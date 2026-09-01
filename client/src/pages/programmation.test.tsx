import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Programmation } from './programmation'

describe('Programmation', () => {
  it('renders without crashing', () => {
    const { container } = render(<Programmation />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('embeds the Resident Advisor events widget for the Parking Radio promoter', () => {
    render(<Programmation />)
    expect(screen.getByTitle('Parking Radio Programmation')).toHaveAttribute(
      'src',
      'https://ra.co/promoters/183980/widget/events?theme=light&transparentBackground=true&customBackgroundColor=&customTextColor=%23000000',
    )
  })
})
