import { useId, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import { addDays } from '../../../quebec-time'
import { THING_KIND_LABELS, formatDay, sessionPerformers } from '../describe'
import { LAST_DAY, isFree, monthOf } from './model'
import type { CalendarDay, DayThing } from './model'
import { OccupationCalendar, OccupationTitle, SessionTitle } from './things'

// The month's grid, from Sunday to Saturday, with what takes each day, and its free time (see "The month" in
// docs/design/client/admin/calendrier.md).

const WEEKDAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']

// How many days each arrow key moves by.
const MOVES: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

type MonthProps = {
  month: string
  // The days of its grid.
  grid: string[]
  // The id of the month's name, which names the table.
  nameId: string
  today: string
  // The chosen day, which is in the grid, if any.
  chosen: string | null
  // What's on each day, once the calendar is read for the grid's days, or else null.
  days: Map<string, CalendarDay> | null
  onChoose: (day: string) => void
  // Opens the form for a new session on a day, from today on, which chooses it.
  onAdd: (day: string) => void
}

// The grid is one stop for the keyboard, its days' buttons: the one with the focus, or else the chosen day, or else today,
// or else the month's first day. Tab from it goes to its "+", if it has one, which the arrows move from as from its day.
export function Month({ month, grid, nameId, today, chosen, days, onChoose, onAdd }: MonthProps) {
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
              const inMonth = monthOf(day) === month
              // Only the month's own days show their free time.
              const entries = (days?.get(day) ?? []).filter((entry) => inMonth || !isFree(entry))
              // What's on the day, which describes its button.
              const entriesId = entries.length > 0 ? `${id}${day}` : undefined
              const classes = [
                !inMonth && 'calendar-other-month',
                day === chosen && 'calendar-chosen',
                entries.some((entry) => isFree(entry) && entry.wholeDay) && 'calendar-available',
              ]
              // The day's button and its "+", which are both its stop, and move with the arrows.
              const stopProps = { tabIndex: day === stop ? 0 : -1, onFocus: () => setFocused(day), onKeyDown: (event: KeyboardEvent) => onKeyDown(event, day) }
              return (
                <td key={day} className={classes.filter(Boolean).join(' ') || undefined} onClick={(event) => onClick(event, day)}>
                  <div className="calendar-day-top">
                    <button
                      type="button"
                      className={day === today ? 'calendar-number calendar-today' : 'calendar-number'}
                      data-day={day}
                      aria-label={formatDay(day)}
                      aria-describedby={entriesId}
                      aria-pressed={day === chosen}
                      aria-current={day === today ? 'date' : undefined}
                      {...stopProps}
                    >
                      {Number(day.slice(8))}
                    </button>
                    {day >= today && day <= LAST_DAY && (
                      <button
                        type="button"
                        className="calendar-add"
                        data-add={day}
                        aria-label={`nouvelle session le ${formatDay(day)}`}
                        title="nouvelle session"
                        {...stopProps}
                        onClick={(event) => {
                          // Rather than choosing the day, or unchoosing it, as its cell does.
                          event.stopPropagation()
                          onAdd(day)
                        }}
                      >
                        +
                      </button>
                    )}
                  </div>
                  {entriesId && (
                    <>
                      <DayMarks entries={entries} />
                      <DayCell id={entriesId} entries={entries} />
                    </>
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// What's on a day, as marks, which narrow screens show in place of its words: a mark for each thing, in order, then a
// circle when it has free time, and a "!" when something on it is in a conflict, drawn by the CSS. Screen readers leave
// them out, since the words describe the day.
function DayMarks({ entries }: { entries: CalendarDay }) {
  const things = entries.filter((entry): entry is DayThing => !isFree(entry))
  const conflict = things.some(({ conflicts }) => conflicts.length > 0)
  return (
    <span className={conflict ? 'calendar-marks calendar-marks-conflict' : 'calendar-marks'} aria-hidden="true">
      {things.map(({ thing, conflicts }, i) => {
        const classes = [`calendar-mark calendar-mark-${thing.kind}`, thing.kind === 'session' && `calendar-mark-${thing.status}`, conflicts.length > 0 && 'calendar-mark-conflict']
        return <span key={i} className={classes.filter(Boolean).join(' ')} />
      })}
      {things.length < entries.length && <span className="calendar-mark calendar-mark-free" />}
    </span>
  )
}

// What's on a day: its things and the stretches of its free time, in order of time.
function DayCell({ id, entries }: { id: string; entries: CalendarDay }) {
  return (
    <ul id={id} className="calendar-things">
      {entries.map((entry, i) =>
        isFree(entry) ? (
          <li key={i} className="calendar-free">
            {entry.wholeDay ? 'disponible' : `dispo ${entry.part}`}
          </li>
        ) : (
          <MonthThing key={i} dayThing={entry} />
        ),
      )}
    </ul>
  )
}

// A thing, in a day of the month: its part of the day, and what it is, after its kind for screen readers, and "conflit"
// when one of its conflicts is on that day.
function MonthThing({ dayThing: { thing, part, conflicts } }: { dayThing: DayThing }) {
  const classes = [`calendar-${thing.kind}`, thing.kind === 'session' && `admin-status-${thing.status}`, conflicts.length > 0 && 'calendar-conflict']
  // A session's performers, which screen readers read after ", avec", or an occupation's calendar, after its title.
  const performers = thing.kind === 'session' && sessionPerformers(thing)
  const detail = performers ? (
    <>
      <span className="visually-hidden">, avec</span> {performers}
    </>
  ) : (
    thing.kind === 'occupation' && thing.title !== null && <OccupationCalendar calendar={thing.calendar} />
  )
  return (
    <li className={classes.filter(Boolean).join(' ')}>
      <span className="calendar-part">{part}</span>
      <span className="calendar-title">
        <span className="visually-hidden">{THING_KIND_LABELS[thing.kind]}&nbsp;: </span>
        {thing.kind === 'session' ? <SessionTitle id={thing.id} title={thing.title} status={thing.status} inMonth /> : <OccupationTitle title={thing.title} calendar={thing.calendar} />}
      </span>
      {detail && <span className="calendar-detail">{detail}</span>}
      {conflicts.length > 0 && <span className="calendar-conflict-tag">conflit</span>}
    </li>
  )
}
