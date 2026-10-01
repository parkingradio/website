// `GET /api/events`: Parking Radio's events, as listed on Resident Advisor. Fails with 502 when
// they can't be fetched from RA.
export type EventsResponse = {
  // The promoter's page on RA.
  promoterUrl: string
  // All of them, in no particular order.
  upcoming: EventListing[]
  // The 20 most recent past events, in no particular order.
  past: EventListing[]
}

export type EventListing = {
  id: string
  title: string
  category: EventCategory
  // RA gives local times without a timezone, and they're passed on as-is: "YYYY-MM-DDTHH:mm".
  start: string
  end: string | null
  venue: string | null
  city: string | null
  lineup: string[]
  // The event's page on RA.
  url: string
  // Full-size flyer on images.ra.co, when the event has one.
  flyer: string | null
}

// Derived by the server from the event's title on RA.
export type EventCategory = 'synth-meetup' | 'other'
