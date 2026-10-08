// Until the calendar is part of this site, this shows the one we use for now, which cross-references the studio's
// booking and other calendars.
const CALENDAR_URL = 'https://calendar-cross-reference.vercel.app/'

export function Calendrier() {
  return (
    <>
      <h1>Calendrier</h1>
      <iframe src={CALENDAR_URL} title="Calendrier des disponibilités" className="admin-calendar" />
    </>
  )
}
