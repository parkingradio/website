import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Calendrier } from './calendrier'

describe('Calendrier', () => {
  it('embeds the calendar we use for now', () => {
    render(<Calendrier />)
    expect(screen.getByTitle('Calendrier des disponibilités')).toHaveAttribute(
      'src',
      'https://calendar-cross-reference.vercel.app/',
    )
  })
})
