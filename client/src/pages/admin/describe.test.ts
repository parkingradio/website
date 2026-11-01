import { describe, expect, it } from 'vitest'
import type { Artist } from '../../artist-profile'
import { deletedWith, membersGenres } from './describe'

describe('membersGenres', () => {
  const artists = new Map(
    (
      [
        ['a', ['techno', 'acid', 'ambient']],
        ['b', ['house']],
        ['c', ['acid', 'house', 'disco', 'jazz']],
        ['d', []],
      ] as const
    ).map(([id, genres]) => [id, { id, genres: [...genres] } as unknown as Artist]),
  )

  it("reads every member's first genre, in the order of the members, then every member's second, and so on, each once", () => {
    expect(membersGenres([{ id: 'a' }, { id: 'b' }, { id: 'c' }], artists)).toEqual(['techno', 'house', 'acid', 'ambient', 'disco', 'jazz'])
    expect(membersGenres([{ id: 'c' }, { id: 'a' }], artists)).toEqual(['acid', 'techno', 'house', 'disco', 'ambient', 'jazz'])
  })

  it('has none for members without genres, or who are unknown, and none without members', () => {
    expect(membersGenres([{ id: 'd' }, { id: 'unknown' }, { id: 'b' }], artists)).toEqual(['house'])
    expect(membersGenres([{ id: 'd' }], artists)).toEqual([])
    expect(membersGenres([], artists)).toEqual([])
  })
})

describe('deletedWith', () => {
  it('lists the photo and the applications, with how many there are when that is known, unless there are none', () => {
    expect(deletedWith('Aurore', true, 2)).toBe('Aurore, sa photo et ses candidatures (2)')
    expect(deletedWith('Aurore', true, null)).toBe('Aurore, sa photo et ses candidatures')
    expect(deletedWith('Aurore', true, 0)).toBe('Aurore et sa photo')
    expect(deletedWith('Aurore', false, 1)).toBe('Aurore et ses candidatures (1)')
    expect(deletedWith('Aurore', false, 0)).toBe('Aurore')
  })
})
