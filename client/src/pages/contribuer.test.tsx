import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Contribuer } from './contribuer'

describe('Contribuer', () => {
  it('renders without crashing', () => {
    const { container } = render(<Contribuer />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('embeds the Zeffy donation form', () => {
    render(<Contribuer />)
    expect(screen.getByTitle('Parking Radio Contribuer')).toHaveAttribute(
      'src',
      'https://www.zeffy.com/embed/donation-form/contribuer-a-parkingradio',
    )
  })
})
