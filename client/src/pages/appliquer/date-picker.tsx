import { useEffect, useState } from 'react'
import { MAX_DATES } from './choices'

type Props = {
  value: string[]
  onChange: (dates: string[]) => void
  // The first and last days that can be picked, "YYYY-MM-DD".
  first: string
  last: string
  invalid: boolean
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const WEEKDAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'] // weeks start on Sunday, as in Québec

// Dates are handled as "YYYY-MM-DD" strings, which sort chronologically; these are the calendar's pieces.
const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`
const parts = (key: string) => key.split('-').map(Number) as [number, number, number]

function describe(key: string) {
  const [year, month, day] = parts(key)
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()]
  return { weekday, label: `${day} ${MONTHS[month - 1]} ${year}` }
}

// Two months side by side, one on phones.
function useMonthsShown() {
  const query = '(max-width: 760px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow ? 1 : 2
}

// Several days picked by clicking them, up to MAX_DATES, between `first` and `last`.
export function DatePicker({ value, onChange, first, last, invalid }: Props) {
  const shown = useMonthsShown()
  const [firstYear, firstMonth] = parts(first)
  const [lastYear, lastMonth] = parts(last)
  // Months are counted from the first possible one, where the calendar opens.
  const monthCount = (lastYear - firstYear) * 12 + (lastMonth - firstMonth) + 1
  const [offset, setOffset] = useState(0)
  const start = Math.max(0, Math.min(offset, monthCount - shown))
  const full = value.length >= MAX_DATES

  const toggle = (key: string) => {
    if (value.includes(key)) onChange(value.filter((date) => date !== key))
    else if (!full) onChange([...value, key].sort())
  }

  const months = Array.from({ length: Math.min(shown, monthCount) }, (_, i) => {
    const date = new Date(firstYear, firstMonth - 1 + start + i, 1)
    return { year: date.getFullYear(), month: date.getMonth() }
  })
  const range =
    months.length === 1
      ? `${MONTHS[months[0].month]} ${months[0].year}`
      : `${MONTHS[months[0].month]} – ${MONTHS[months[months.length - 1].month]} ${months[months.length - 1].year}`

  return (
    <div className="calendar-wrap">
      {/* Focusable, so that the form can bring the artist here when no date is picked. */}
      <div
        className={invalid ? 'calendar invalid' : 'calendar'}
        role="group"
        aria-label="Dates souhaitées"
        aria-invalid={invalid || undefined}
        tabIndex={-1}
      >
        <div className="calendar-bar">
          <span>{range}</span>
          <div className="calendar-nav">
            <button type="button" aria-label="Mois précédent" disabled={start === 0} onClick={() => setOffset(start - 1)}>
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M9 2 4 7l5 5" />
              </svg>
            </button>
            <button type="button" aria-label="Mois suivant" disabled={start + shown >= monthCount} onClick={() => setOffset(start + 1)}>
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="m5 2 5 5-5 5" />
              </svg>
            </button>
          </div>
        </div>
        <div className="months" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
          {months.map(({ year, month }) => {
            const days = new Date(year, month + 1, 0).getDate()
            const blanks = new Date(year, month, 1).getDay()
            return (
              <div key={`${year}-${month}`} className="month">
                <h3>
                  {MONTHS[month]} <span>{year}</span>
                </h3>
                <div className="days">
                  {WEEKDAYS.map((weekday) => (
                    <span key={weekday} className="weekday">
                      {weekday}
                    </span>
                  ))}
                  {Array.from({ length: blanks }, (_, i) => (
                    <span key={`blank-${i}`} />
                  ))}
                  {Array.from({ length: days }, (_, i) => {
                    const key = dayKey(year, month, i + 1)
                    const picked = value.includes(key)
                    const outside = key < first || key > last
                    const { weekday, label } = describe(key)
                    return (
                      <button
                        key={key}
                        type="button"
                        className="day"
                        aria-pressed={picked}
                        aria-label={`${weekday} ${label}`}
                        disabled={outside || (full && !picked)}
                        onClick={() => toggle(key)}
                      >
                        {i + 1}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="calendar-foot">
          <span>à partir du {describe(first).label}</span>
          <span>jusqu'au {describe(last).label}</span>
        </div>
      </div>
      <div className="picked" aria-live="polite">
        <div className="picked-head">
          <span>dates choisies</span>
          <b className={full ? 'full' : undefined}>
            {value.length} / {MAX_DATES}
          </b>
        </div>
        {full && <p className="picked-full">maximum atteint : enlevez une date pour en choisir une autre.</p>}
        {value.length === 0 ? (
          <p className="picked-empty">Aucune date pour l'instant. Choisissez-en au moins une dans le calendrier.</p>
        ) : (
          <ul>
            {value.map((key) => {
              const { weekday, label } = describe(key)
              return (
                <li key={key}>
                  <span>
                    <span className="weekday">{weekday}</span>
                    {label}
                  </span>
                  <button type="button" aria-label={`Enlever le ${label}`} onClick={() => toggle(key)}>
                    <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                      <path d="M1 1l8 8M9 1 1 9" />
                    </svg>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {value.length > 0 && (
          <button type="button" className="clear" onClick={() => onChange([])}>
            tout effacer
          </button>
        )}
      </div>
    </div>
  )
}
