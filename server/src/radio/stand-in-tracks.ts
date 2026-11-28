// The tracks that the stand-in for SoundCloud knows as they are on SoundCloud (see soundcloud-stand-in.ts), which the seed
// gives its sets (see e2e/seed-data.ts), so that the admin pages show what they'd show for real tracks, and their links
// lead to them: a sample of Parking Radio's public tracks, each with its link, as sets keep it
// ("https://soundcloud.com/<account>/<track>", see "Links" in docs/design/server/sessions.md), and SoundCloud's id for it
// and its length, in milliseconds, as SoundCloud gives them. On its own, so that both can import it, without what the
// stand-in imports.

// What the name of a track ends with when the stand-in only lets a preview of it be played, e.g. for a set of the rotation
// that's skipped.
export const PREVIEW_SUFFIX = '-preview'

export type StandInTrack = { link: string; id: string; durationMs: number }

export const STAND_IN_TRACKS: readonly StandInTrack[] = [
  { link: 'https://soundcloud.com/parkingdotradio/jeysyano', id: '2400743229', durationMs: 3_286_174 },
  { link: 'https://soundcloud.com/parkingdotradio/lexferenda', id: '2400743424', durationMs: 3_639_646 },
  { link: 'https://soundcloud.com/parkingdotradio/softwarewolfe', id: '2400744318', durationMs: 4_230_598 },
  { link: 'https://soundcloud.com/parkingdotradio/deneb', id: '2416098978', durationMs: 3_885_528 },
  { link: 'https://soundcloud.com/parkingdotradio/boomy', id: '2416126665', durationMs: 3_723_587 },
  { link: 'https://soundcloud.com/parkingdotradio/crissemarqueur', id: '2416195722', durationMs: 4_030_403 },
  { link: 'https://soundcloud.com/parkingdotradio/esile', id: '2421013821', durationMs: 3_569_902 },
  { link: 'https://soundcloud.com/parkingdotradio/chloelallouz', id: '2421043488', durationMs: 3_431_683 },
  { link: 'https://soundcloud.com/parkingdotradio/simulat3dhuman', id: '2421071514', durationMs: 3_852_718 },
  { link: 'https://soundcloud.com/parkingdotradio/omizs', id: '2421498267', durationMs: 3_395_416 },
  { link: 'https://soundcloud.com/parkingdotradio/palmeer', id: '2421524850', durationMs: 3_589_272 },
  { link: 'https://soundcloud.com/parkingdotradio/chvck', id: '2421553863', durationMs: 3_677_102 },
  { link: 'https://soundcloud.com/parkingdotradio/queeniejr-20261029', id: '2428830156', durationMs: 3_723_800 },
  { link: 'https://soundcloud.com/parkingdotradio/vayia', id: '2428868787', durationMs: 3_776_792 },
  { link: 'https://soundcloud.com/parkingdotradio/mizen', id: '2428908216', durationMs: 3_773_891 },
]
