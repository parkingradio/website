import { useId } from 'react'
import { Link } from 'react-router'
import type { Schema } from '../../../api/client'
import { ReadFailure } from '../configuration/calendar-feeds'
import { FEED_KIND_LABELS, capitalized, lastRead } from '../describe'
import type { Feed } from './model'

// Where each kind of thing comes from (see "Sources" in docs/design/client/admin/calendrier.md).

const KINDS: Schema<'FeedKind'>[] = ['occupation', 'quiet-time']

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
        {KINDS.map((kind) => {
          const ofKind = feeds.filter((feed) => feed.kind === kind)
          return [
            <dt key={`${kind} term`}>{capitalized(FEED_KIND_LABELS[kind])}</dt>,
            <dd key={`${kind} feeds`}>
              {ofKind.length === 0 ? (
                <p className="calendar-source">
                  Aucun calendrier pour le moment&nbsp;: ils s'ajoutent dans <Link to="/admin/configuration">Configuration</Link>,
                  «&nbsp;Calendriers externes&nbsp;».
                </p>
              ) : (
                ofKind.map((feed) => (
                  <div key={feed.id} className="calendar-source">
                    <p>
                      <b>{feed.name}</b> <span className="admin-meta">{lastRead(feed)}</span>
                    </p>
                    <ReadFailure feed={feed} />
                  </div>
                ))
              )}
            </dd>,
          ]
        })}
      </dl>
    </section>
  )
}
