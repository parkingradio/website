import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { Loaded } from '../../api/use-api'
import type { Schema } from '../../api/client'
import type { Collective } from '../../collective-profile'
import { Combobox } from '../../combobox'
import { quebecDayAndTime } from '../../quebec-time'
import { after, checkSession, durationOf, endTimeAfter, minutesOf, sessionTimes } from '../../session-fields'
import type { Reference, SessionFields, SessionFormValues } from '../../session-fields'
import { raEventId, raEventUrl } from '../../session-links'
import { leaving, useCheckedForm } from './checked-form'
import { collectiveOption, formatDuration, formatLongQuebecDay, formatShortDay } from './describe'
import { DurationField, FieldError, FormActions, Labeled } from './fields'
import { compareText } from './list'
import type { GroupProps } from './profile-fields'

// A form for a session, to add a session or change one, but not its sets. Like the artist form (see artist-form.tsx),
// each field is checked as the server checks it (see `checkSession`), and says what's wrong once it's been left, or once
// the form is sent, and the server's error is shown if it refuses the session anyway.

export type SessionFormProps = {
  // What the form starts with: a session's, to change it, or what a new one starts with.
  initial: SessionFormValues
  // Whether the session has sets, which move with it.
  hasSets?: boolean
  // The collectives the takeover's is picked from, or null when they couldn't be loaded, which leaves the session's as
  // it is.
  collectives: Collective[] | null
  // The events read from RA, which the form doesn't wait for.
  events: Loaded<Schema<'Events'>>
  submitLabel: string
  // Sends the session's fields, and returns the error, if it failed.
  onSubmit: (fields: SessionFields) => Promise<ReactNode | null>
  onCancel?: () => void
}

export function SessionForm({ initial, hasSets = false, collectives, events, submitLabel, onSubmit, onCancel }: SessionFormProps) {
  const [form, setForm] = useState(initial)
  const update = (changes: Partial<SessionFormValues>) => setForm((form) => ({ ...form, ...changes }))
  const times = sessionTimes(form)
  const checked = checkSession(form, times)
  const errors = checked.errors ?? {}
  // There are fields, since there are no errors by then.
  const { form: formRef, submit, busy, error, shown, leave } = useCheckedForm(errors, () => onSubmit(checked.fields!))

  return (
    <form ref={formRef} className="admin-form admin-form-wide" onSubmit={submit} noValidate>
      <TimesField
        form={form}
        times={times}
        hasSets={hasSets}
        onChange={update}
        errors={{ day: shown('day'), start: shown('start'), end: shown('end'), duration: shown('duration') }}
        onLeave={leave('day', 'start', 'end', 'duration')}
      />

      <TakeoverField takeover={form.takeover} collectives={collectives} onChange={(takeover) => update({ takeover })} />

      <Labeled label="Nom" error={shown('name')}>
        <input
          value={form.name}
          placeholder="p. ex. HAUTE RIVE TAKEOVER"
          aria-invalid={shown('name') ? true : undefined}
          onChange={(event) => update({ name: event.target.value })}
          onBlur={leave('name')}
        />
      </Labeled>

      <RaEventField link={form.raEvent} events={events} onChange={(raEvent) => update({ raEvent })} error={shown('raEvent')} onLeave={leave('raEvent')} />

      <FormActions error={error} busy={busy} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  )
}

// The day the session starts, and the times it starts and ends, in Québec time, then how long it lasts, and when it ends
// the next day, once they're valid. Or only its duration, while its date isn't known.
function TimesField({
  form,
  times,
  hasSets,
  onChange,
  errors,
  onLeave,
}: {
  form: SessionFormValues
  times: ReturnType<typeof sessionTimes>
  hasSets: boolean
  onChange: (changes: Partial<SessionFormValues>) => void
  errors: Partial<Record<'day' | 'start' | 'end' | 'duration', string>>
  onLeave: () => void
}) {
  // When the session starts and how long it lasts, once its day and times are valid.
  const dated = 'start' in times && times.start ? { start: times.start, durationMinutes: times.durationMinutes } : null
  const end = dated && after(dated.start, dated.durationMinutes)
  const error = errors.day ?? errors.start ?? errors.end
  // Checking "date à déterminer" keeps how long the session lasts, when its times say it.
  const setUndated = (undated: boolean) => {
    const dated = sessionTimes({ ...form, undated: false })
    onChange(undated && 'start' in dated ? { undated, duration: durationOf(dated.durationMinutes) } : { undated })
  }
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Quand</legend>
      <div className="admin-choices">
        <label>
          <input type="checkbox" checked={form.undated} onChange={(event) => setUndated(event.target.checked)} />
          date à déterminer
        </label>
      </div>
      {form.undated ? (
        <DurationField label="Durée" value={form.duration} onChange={(duration) => onChange({ duration })} error={errors.duration} />
      ) : (
        <>
          <p className="admin-hint">Heure du Québec. Une fin qui n'est pas après le début est le lendemain.</p>
          <div className="admin-row admin-times">
            <label>
              Date
              <input type="date" value={form.day} aria-invalid={errors.day ? true : undefined} onChange={(event) => onChange({ day: event.target.value })} />
            </label>
            <label>
              Début
              <input
                type="time"
                value={form.start}
                aria-invalid={errors.start ? true : undefined}
                onChange={(event) => {
                  const start = event.target.value
                  // A session whose date wasn't known keeps lasting as long once it has one.
                  const lasts = minutesOf(form.duration)
                  onChange(form.end || !start || !lasts ? { start } : { start, end: endTimeAfter(form.day, start, lasts) })
                }}
              />
            </label>
            <label>
              Fin
              <input type="time" value={form.end} aria-invalid={errors.end ? true : undefined} onChange={(event) => onChange({ end: event.target.value })} />
            </label>
          </div>
          {dated && end && (
            <p className="admin-hint" role="status">
              Dure {formatDuration(dated.durationMinutes)}
              {quebecDayAndTime(end).day !== form.day && `, finit le lendemain, ${formatLongQuebecDay(end.toISOString())}`}.
            </p>
          )}
          <FieldError message={error} />
        </>
      )}
      {hasSets && <p className="admin-hint">Ses sets se déplacent avec elle.</p>}
    </fieldset>
  )
}

// The collective whose takeover the session is, or none. When the collectives couldn't be loaded, the session's stays.
function TakeoverField({ takeover, collectives, onChange }: { takeover: Reference | null; collectives: Collective[] | null; onChange: (takeover: Reference | null) => void }) {
  const id = useId()
  const listed = collectives ? collectives.map(collectiveOption).sort((a, b) => compareText(a.label, b.label)) : takeover ? [{ key: takeover.id, label: takeover.name }] : []
  return (
    <div className="admin-field">
      <label htmlFor={id}>Takeover de</label>
      <Combobox
        id={id}
        options={[{ key: '', label: 'Aucun takeover' }, ...listed]}
        selected={takeover?.id ?? ''}
        onSelect={(key) => {
          const collective = collectives?.find((collective) => collective.id === key)
          onChange(collective ? { id: collective.id, name: collective.name } : null)
        }}
        disabled={!collectives}
      />
      <p className="admin-hint">Le collectif dont c'est le takeover, s'il y en a un.</p>
    </div>
  )
}

// The event on RA, by the link to its page, which picking one of the events read from RA fills in, once they are. Older
// events are pasted.
function RaEventField({ link, events: loaded, onChange, error, onLeave }: GroupProps<string> & { link: string; events: Loaded<Schema<'Events'>> }) {
  const pickerId = useId()
  // The upcoming ones, the soonest first, then the past ones, the most recent first.
  const events =
    loaded.kind === 'loaded'
      ? [...loaded.value.upcoming.toSorted((a, b) => a.start.localeCompare(b.start)), ...loaded.value.past.toSorted((a, b) => b.start.localeCompare(a.start))]
      : []
  // Events' days are RA's, without a time zone: the day is the start's, as it's written.
  const options = [{ key: '', label: 'Aucun événement RA' }, ...events.map((event) => ({ key: event.id, label: event.title, detail: formatShortDay(event.start.slice(0, 10)) }))]
  // The event the link leads to, if it's one of those read from RA, or none when there's no link.
  const id = link.trim() ? raEventId(link.trim()) : ''
  const selected = id !== null && options.some((option) => option.key === id) ? id : null
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Événement RA</legend>
      <div className="admin-field">
        <label htmlFor={pickerId}>Parmi les événements de RA</label>
        <Combobox
          id={pickerId}
          options={options}
          selected={selected}
          onSelect={(key) => onChange(key && raEventUrl(key))}
          placeholder={loaded.kind === 'loading' ? 'chargement des événements…' : 'choisir un événement…'}
        />
        {loaded.kind === 'error' && (
          <p className="admin-hint">
            Les événements n'ont pas pu être lus sur RA&nbsp;: {loaded.message.replace(/\.$/, '')}. Collez le lien de l'événement.
          </p>
        )}
      </div>
      <Labeled label="Lien de l'événement" error={error}>
        <input type="url" value={link} placeholder="https://ra.co/events/…" aria-invalid={error ? true : undefined} onChange={(event) => onChange(event.target.value)} />
      </Labeled>
      <p className="admin-hint">Pour un événement plus ancien que ceux de la liste, collez le lien de sa page sur RA.</p>
    </fieldset>
  )
}
