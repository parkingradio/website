import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Archive } from './archive'

describe('Archive', () => {
  it('renders without crashing', () => {
    const { container } = render(<Archive />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('embeds the SoundCloud player for the parkingdotradio account', () => {
    render(<Archive />)
    expect(screen.getByTitle('Parking Radio Archives')).toHaveAttribute(
      'src',
      'https://w.soundcloud.com/player/?url=https://soundcloud.com/parkingdotradio&visual=false&buying=false&liking=true&download=false&sharing=true&show_comments=true&show_playcount=true&show_teaser=true&show_user=false&hide_related=true&show_reposts=true&callback=true',
    )
  })
})
