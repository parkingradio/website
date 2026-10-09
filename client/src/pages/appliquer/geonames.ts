import { useEffect, useRef, useState } from 'react'
import type { ComboboxOption } from '../../combobox'

// City suggestions come straight from GeoNames' free web service (https://www.geonames.org/export/web-services.html).
// The account name has to be sent with every request, so it's public by design: all it protects is our daily
// quota. The free service comes with no guarantee either, so the form must keep working without it.
const SEARCH_URL = 'https://secure.geonames.org/searchJSON'
const USERNAME = 'parkingradio'
const MAX_RESULTS = 10

type Result = {
  geonameId: number
  toponymName: string
  fcode: string
  adminName1?: string
  adminCodes1?: { ISO3166_2?: string }
}

// A city GeoNames knows. Only its name is sent with the application, but its region tells cities with the same name
// apart: its postal abbreviation in Canada and the US ("QC"), its name elsewhere.
export type City = { geonameId: number; name: string; region: string | null }

// Cities of `country` with at least 5000 inhabitants whose name starts with `query` (accents and case don't
// matter), biggest first. Throws when GeoNames can't be reached or refuses the request.
async function searchCities(country: string, query: string): Promise<City[]> {
  const params = new URLSearchParams({
    name_startsWith: query,
    country,
    featureClass: 'P', // populated places
    cities: 'cities5000',
    orderby: 'population',
    lang: 'fr', // for the regions' names
    maxRows: String(MAX_RESULTS),
    username: USERNAME,
  })
  const response = await fetch(`${SEARCH_URL}?${params}`)
  if (!response.ok) throw new Error(`GeoNames responded with ${response.status}`)
  // Errors, like a used-up quota, come with a 200 and a `status` instead of results.
  const body: { geonames?: Result[]; status?: { message: string } } = await response.json()
  if (!body.geonames) throw new Error(`GeoNames refused the search: ${body.status?.message}`)

  return (
    body.geonames
      // Parts of a city (e.g. Lyon's arrondissements) would crowd out actual cities.
      .filter((result) => result.fcode !== 'PPLX')
      .map((result) => ({
        geonameId: result.geonameId,
        // `name` is whichever of the city's names matched the query, often without its accents (e.g.
        // "Trois-Rivieres"). `toponymName` is its usual name.
        name: result.toponymName,
        // People know Canadian provinces and US states by their postal abbreviations ("QC").
        region: (country === 'CA' || country === 'US' ? result.adminCodes1?.ISO3166_2 : result.adminName1) || null,
      }))
  )
}

// How long to wait after the last keystroke before searching, so that only what the artist stops at is searched.
const SUGGEST_DELAY_MS = 300

// The cities of `country` to suggest for `query`, as options, once they've been found. None while there's no country
// or a single letter, which would match too many cities to be useful, nor when GeoNames can't be reached.
export function useCitySuggestions(country: string | null, query: string): ComboboxOption[] {
  // The cities found, and the country and query they were found for.
  const [found, setFound] = useState<{ for: string; options: ComboboxOption[] }>({ for: '', options: [] })
  // Each search, by country and query, so that typing the same thing again doesn't use up the quota again. Searches
  // that fail are forgotten, to be tried again.
  const searches = useRef(new Map<string, Promise<City[]>>())
  // The name of a city that was just suggested, e.g. once it's picked, needs no other search: its suggestions stay.
  const suggested =
    found.for.startsWith(`${country}|`) && found.options.some((option) => option.label.toLowerCase() === query.trim().toLowerCase())
  const searched = suggested ? found.for : country && query.trim().length >= 2 ? `${country}|${query.trim().toLowerCase()}` : null

  useEffect(() => {
    if (!country || !searched || suggested) return
    let cancelled = false
    const timer = setTimeout(() => {
      let search = searches.current.get(searched)
      if (!search) {
        search = searchCities(country, query.trim())
        search.catch(() => searches.current.delete(searched))
        searches.current.set(searched, search)
      }
      search.then(
        (cities) => {
          const options = cities.map((city) => ({ key: String(city.geonameId), label: city.name, detail: city.region }))
          if (!cancelled) setFound({ for: searched, options })
        },
        () => {},
      )
    }, SUGGEST_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [country, query, searched, suggested])

  return found.for === searched ? found.options : []
}
