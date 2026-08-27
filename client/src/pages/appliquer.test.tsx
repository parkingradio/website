import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Appliquer } from './appliquer'

describe('Appliquer', () => {
  it('renders without crashing', () => {
    const { container } = render(<Appliquer />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('embeds the artist application Google Form', () => {
    render(<Appliquer />)
    expect(screen.getByTitle('Parking Radio Appliquer')).toHaveAttribute(
      'src',
      'https://docs.google.com/forms/d/e/1FAIpQLSctvcYT2JPzdP446KPiHf6ipRwmZUSlPqMvCGTIyk4Wrptjlw/viewform',
    )
  })
})
