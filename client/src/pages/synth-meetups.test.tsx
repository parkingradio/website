import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SynthMeetups } from './synth-meetups'

describe('SynthMeetups', () => {
  it('renders without crashing', () => {
    const { container } = render(<SynthMeetups />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('renders the banner and one thumbnail button per poster', () => {
    render(<SynthMeetups />)
    expect(screen.getByAltText('Synth Meetups')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(6)
  })

  it('expands a poster into a lightbox on click, and closes it on a second click', () => {
    render(<SynthMeetups />)
    expect(screen.getAllByRole('img')).toHaveLength(7) // banner + 6 thumbnails

    fireEvent.click(screen.getAllByRole('button')[0])
    const lightboxImage = screen.getAllByRole('img').at(-1)
    expect(lightboxImage).toBeVisible()
    expect(screen.getAllByRole('img')).toHaveLength(8) // + the lightbox image

    fireEvent.click(lightboxImage!)
    expect(screen.getAllByRole('img')).toHaveLength(7) // back to banner + 6 thumbnails
  })
})
