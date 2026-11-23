import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, formData } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { checkSession, sessionTimes } from '../../../session-fields'
import { useCheckedForm } from '../checked-form'
import { formatDuration } from '../describe'
import { FormActions, Labeled } from '../fields'
import { CollectivesFailure } from '../profile-details'
import { failure, sessionPath } from '../session-errors'
import { NameField, TakeoverField, TypeField } from '../session-form'
import { sessionOnDay } from './model'
import type { NewSessionOnDay } from './model'

// A short form for a new session on the chosen day, `day`, under its things, which adds it without sets, then goes to
// its page (see "A new session" in docs/design/client/admin/calendrier.md). It's checked as the session form checks it,
// with the collectives loaded each time it opens. It puts the focus on its heading when it opens, and whenever
// `focusRequests` changes, rather than on its start, which would say what's wrong with it once it's left, moving what's
// under it, e.g. as it's tapped.

const EMPTY: NewSessionOnDay = { start: '', end: '', type: null, takeover: null, name: '' }

export function NewSessionForm({ day, focusRequests, onCancel }: { day: string; focusRequests: number; onCancel: () => void }) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [focusRequests])
  const navigate = useNavigate()
  const collectives = useApi('/api/admin/collectives')
  const [values, setValues] = useState(EMPTY)
  const update = (changes: Partial<NewSessionOnDay>) => setValues((values) => ({ ...values, ...changes }))
  const form = sessionOnDay(day, values)
  const times = sessionTimes(form)
  const checked = checkSession(form, times)
  const { form: formRef, submit, busy, error, shown, leave } = useCheckedForm(checked.errors ?? {}, async () => {
    // There are fields, since there are no errors by then.
    const result = await api.POST('/api/admin/sessions', { body: { session: checked.fields! }, bodySerializer: formData })
    if (!result.ok) return failure("La session n'a pas pu être ajoutée", result)
    navigate(sessionPath(result.session))
    return null
  })

  // The years' errors are about the days: the chosen day, and the one the session ends on.
  const startError = shown('day') ?? shown('start')
  const endError = shown('endDay') ?? shown('end')
  const lasts = 'start' in times && times.start ? times.durationMinutes : null
  return (
    <form ref={formRef} className="admin-form calendar-new" aria-labelledby={headingId} onSubmit={submit} noValidate>
      <h3 id={headingId} ref={heading} className="calendar-heading" tabIndex={-1}>
        Nouvelle session
      </h3>
      {collectives.kind === 'error' && <CollectivesFailure message={collectives.message} />}
      <div className="admin-row admin-times">
        <Labeled label="Début" error={startError}>
          <input
            type="time"
            value={values.start}
            aria-invalid={startError ? true : undefined}
            onChange={(event) => update({ start: event.target.value })}
            onBlur={leave('start', 'day')}
          />
        </Labeled>
        <Labeled label="Fin" error={endError}>
          <input
            type="time"
            value={values.end}
            aria-invalid={endError ? true : undefined}
            onChange={(event) => update({ end: event.target.value })}
            onBlur={leave('end', 'endDay')}
          />
        </Labeled>
      </div>
      {lasts !== null && (
        <p className="admin-hint" role="status">
          Dure {formatDuration(lasts)}
          {form.endDay !== day && ", jusqu'au lendemain"}.
        </p>
      )}
      <TypeField type={values.type} onChange={(type) => update({ type })} error={shown('type')} onLeave={leave('type')} />
      {values.type === 'takeover' && (
        <TakeoverField
          takeover={values.takeover}
          collectives={collectives.kind === 'loaded' ? collectives.value.collectives : null}
          onChange={(takeover) => update({ takeover })}
          error={shown('takeover')}
          onLeave={leave('takeover')}
        />
      )}
      {values.type === 'other' && <NameField form={form} onChange={(name) => update({ name })} error={shown('name')} onLeave={leave('name')} />}
      <FormActions error={error} busy={busy} submitLabel="créer" onCancel={onCancel} />
    </form>
  )
}
