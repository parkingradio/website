import { useId, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import { addDays } from '../../../quebec-time'
import { THING_KIND_LABELS, formatDay, sessionPerformers } from '../describe'
import { WHOLE_DAY, gridDays, monthOf } from './model'
import type { CalendarDay, DayThing } from './model'
import { OccupationCalendar, OccupationTitle, SessionTitle } from './things'

// The month's grid, from Sunday to Saturday, with what takes each day, and its free time (see "The month" in
// docs/design/client/admin/calendrier.md).

const WEEKDAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']

// How many days each arrow key moves by.
const MOVES: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

type MonthProps = {
  month: string
  // The id of the month's name, which names the table.
  nameId: string
  today: string
  // The chosen day, which is in the grid, if any.
  chosen: string | null
  // What's on each day, once the calendar is read for the grid's days, or else null.
  days: Map<string, CalendarDay> | null
  onChoose: (day: string) => void
}

// The grid is one stop for the keyboard, its days' buttons: the one with the focus, or else the chosen day, or else today,
// or else the month's first day.
export function Month({ month, nameId, today, chosen, days, onChoose }: MonthProps) {
  const grid = gridDays(month)
  const id = useId()
  const [focused, setFocused] = useState<string | null>(null)
  const stop = focused ?? chosen ?? (grid.includes(today) ? today : `${month}-01`)
  const table = useRef<HTMLTableElement>(null)
  const onBlur = (event: FocusEvent) => {
    if (!table.current?.contains(event.relatedTarget as Node | null)) setFocused(null)
  }

  const onKeyDown = (event: KeyboardEvent, day: string) => {
    const by = MOVES[event.key]
    if (by === undefined) return
    event.preventDefault()
    const next = addDays(day, by)
    // It stops at the grid's edges.
    table.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus()
  }
  // Clicking anywhere in a day chooses it, except on a session's link, which opens its page.
  const onClick = (event: MouseEvent, day: string) => {
    if (!(event.target as Element).closest('a')) onChoose(day)
  }

  return (
    <table className="calendar-month" aria-labelledby={nameId} ref={table} onBlur={onBlur}>
      <thead>
        <tr>
          {WEEKDAYS.map((weekday) => (
            <th key={weekday} scope="col">
              {weekday}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: grid.length / 7 }, (_, week) => (
          <tr key={grid[week * 7]}>
            {grid.slice(week * 7, week * 7 + 7).map((day) => {
              const shown = days?.get(day)
              const things = shown?.things ?? []
              const inMonth = monthOf(day) === month
              // Only the month's own days show their free time.
              const free = shown && inMonth ? shown.free : []
              // What's on the day, which describes its button.
              const thingsId = things.length > 0 || free.length > 0 ? `${id}${day}` : undefined
              const classes = [
                !inMonth && 'calendar-other-month',
                day === chosen && 'calendar-chosen',
                free[0] === WHOLE_DAY && 'calendar-available',
              ]
              return (
                <td key={day} className={classes.filter(Boolean).join(' ') || undefined} onClick={(event) => onClick(event, day)}>
                  <button
                    type="button"
                    className={day === today ? 'calendar-number calendar-today' : 'calendar-number'}
                    data-day={day}
                    tabIndex={day === stop ? 0 : -1}
                    aria-label={formatDay(day)}
                    aria-describedby={thingsId}
                    aria-pressed={day === chosen}
                    aria-current={day === today ? 'date' : undefined}
                    onFocus={() => setFocused(day)}
                    onKeyDown={(event) => onKeyDown(event, day)}
                  >
                    {Number(day.slice(8))}
                  </button>
                  {thingsId && <DayCell id={thingsId} things={things} free={free} />}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// What's on a day: its things, then its free time.
function DayCell({ id, things, free }: { id: string; things: DayThing[]; free: string[] }) {
  return (
    <ul id={id} className="calendar-things">
      {things.map((dayThing, i) => (
        <MonthThing key={i} dayThing={dayThing} />
      ))}
      {free.map((stretch) => (
        <li key={stretch} className="calendar-free">
          {stretch === WHOLE_DAY ? 'disponible' : `dispo ${stretch}`}
        </li>
      ))}
    </ul>
  )
}

// A thing, in a day of the month: its part of the day, and what it is, after its kind for screen readers, and "conflit"
// when one of its conflicts is on that day.
function MonthThing({ dayThing: { thing, part, conflictsWith } }: { dayThing: DayThing }) {
  const classes = [`calendar-${thing.kind}`, thing.kind === 'session' && thing.status !== 'planned' && `admin-status-${thing.status}`, conflictsWith.length > 0 && 'calendar-conflict']
  // A session's performers, or an occupation's calendar, after its title.
  const detail = thing.kind === 'session' ? sessionPerformers(thing) : thing.title !== null && <OccupationCalendar calendar={thing.calendar} />
  return (
    <li className={classes.filter(Boolean).join(' ')}>
      <span className="calendar-part">{part}</span>
      <span className="calendar-title">
        <span className="visually-hidden">{THING_KIND_LABELS[thing.kind]}&nbsp;: </span>
        {thing.kind === 'session' ? <SessionTitle id={thing.id} title={thing.title} status={thing.status} inMonth /> : <OccupationTitle title={thing.title} calendar={thing.calendar} />}
      </span>
      {detail && <span className="calendar-detail">{detail}</span>}
      {conflictsWith.length > 0 && <span className="calendar-conflict-tag">conflit</span>}
    </li>
  )
}
