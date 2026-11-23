// A calendar feed's name, and "titres masqués" when its titles are private, as Configuration's "Calendriers externes" and
// Calendrier's "Sources" say it.
export function FeedName({ feed }: { feed: { name: string; privateTitles: boolean } }) {
  return (
    <>
      <b>{feed.name}</b>
      {feed.privateTitles && ' (titres masqués)'}
    </>
  )
}

// Why a calendar feed's last read failed, if it did, as Configuration's "Calendriers externes" and Calendrier's "Sources"
// say it.
export function ReadFailure({ feed }: { feed: { error: string | null } }) {
  return feed.error && <p className="admin-error">La dernière lecture a échoué&nbsp;: {feed.error}</p>
}
