import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Home } from './home'

describe('Home', () => {
  it('renders without crashing', () => {
    const { container } = render(<Home />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('embeds the combined radio/video/chat widget', () => {
    render(<Home />)
    expect(screen.getByTitle('Parking Radio')).toHaveAttribute(
      'src',
      'https://pub-ac6abcc67fed4f8f8072bac54bb99274.r2.dev/combined_widget.html',
    )
  })
})
