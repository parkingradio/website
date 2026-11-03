import { describe, expect, it } from 'vitest'
import { normalize } from './normalize'

describe('normalize', () => {
  it('ignores case and accents, with hyphens, apostrophes and dots as spaces, and ligatures as their letters', () => {
    expect(normalize('  Côte d’Ivoire ')).toBe('cote d ivoire')
    expect(normalize('États-Unis')).toBe('etats unis')
    expect(normalize('Les Sœurs.ŒUVRE')).toBe('les soeurs oeuvre')
    expect(normalize('Lætitia ÆLIS')).toBe('laetitia aelis')
  })
})
