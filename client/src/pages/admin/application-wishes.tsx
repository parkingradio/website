import type { Application } from '../../application-fields'
import { formatDay } from './describe'

// When an artist would like to play, as an application's page shows it, within a record (`dl`): the days, then the time
// slots, or "à toute heure" without any.
export function ApplicationWishes({ application }: { application: Pick<Application, 'dates' | 'timeSlots'> }) {
  return (
    <>
      <dt>Dates souhaitées</dt>
      <dd>
        <ul>
          {application.dates.map((date) => (
            <li key={date}>{formatDay(date)}</li>
          ))}
        </ul>
      </dd>
      <dt>Plages horaires</dt>
      <dd>{application.timeSlots.length === 0 ? 'à toute heure' : application.timeSlots.map(({ start, end }) => `${start} à ${end}`).join(', ')}</dd>
    </>
  )
}
