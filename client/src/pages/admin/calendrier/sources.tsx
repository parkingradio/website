import { useId } from 'react'
import { Link } from 'react-router'
import { lastRead } from '../describe'
import { FeedName, ReadFailure } from '../feeds'
import type { Feed } from './model'

// Where each kind of thing comes from (see "Sources" in docs/design/client/admin/calendrier.md).
export function Sources({ feeds }: { feeds: Feed[] }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Sources</h2>
      <dl className="admin-record">
        <dt>Sessions</dt>
        <dd>
          Entrées sur le site, dans <Link to="/admin/sessions">Sessions</Link>.
        </dd>
        <dt>Occupations</dt>
        <dd>
          {feeds.length === 0 ? (
            <p className="calendar-source">
              Aucun calendrier pour le moment&nbsp;: ils s'ajoutent dans <Link to="/admin/configuration">Configuration</Link>,
              «&nbsp;Calendriers externes&nbsp;».
            </p>
          ) : (
            feeds.map((feed) => (
              <div key={feed.id} className="calendar-source">
                <p>
                  <FeedName feed={feed} /> <span className="admin-meta">{lastRead(feed)}</span>
                </p>
                <ReadFailure feed={feed} />
              </div>
            ))
          )}
        </dd>
      </dl>
    </section>
  )
}
