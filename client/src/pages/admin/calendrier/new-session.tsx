import { useEffect, useId, useRef, useState } from 'react'
import { api, formData } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { useCheckedForm } from '../checked-form'
import { formatDuration } from '../describe'
import { FieldError, FormActions, TimeInput } from '../fields'
import { CollectivesFailure } from '../profile-details'
import type { Session } from '../../../session-fields'
import { failure } from '../session-errors'
import { NameField, TakeoverField, TypeField } from '../session-form'
import { checkSessionOnDay } from './new-session-fields'
import type { NewSessionOnDay } from './new-session-fields'

// A short form for a new session on the chosen day, `day`, under its things, which adds it without sets, then says so with
// `onAdded` (see "A new session" in docs/design/client/admin/calendrier.md). It's checked as the session form checks it,
// with the collectives loaded each time it opens. It puts the focus on its heading when it opens, and whenever
// `focusRequests` changes, rather than on its start, which would say what's wrong with it once it's left, moving what's
// under it, e.g. as it's tapped.

const EMPTY: NewSessionOnDay = { start: '', end: '', type: null, takeover: null, name: '' }

type NewSessionFormProps = {
  day: string
  // Changes each time the form is to take the focus again, e.g. when its "+" is used while it's open.
  focusRequests: number
  onCancel: () => void
  onAdded: (session: Session) => void
}

export function NewSessionForm({ day, focusRequests, onCancel, onAdded }: NewSessionFormProps) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [focusRequests])
  const collectives = useApi('/api/admin/collectives')
  const [values, setValues] = useState(EMPTY)
  const update = (changes: Partial<NewSessionOnDay>) => setValues((values) => ({ ...values, ...changes }))
  const checked = checkSessionOnDay(day, values)
  const { form: formRef, submit, busy, error, shown, leave } = useCheckedForm(checked.errors ?? {}, async () => {
    // There are fields, since there are no errors by then.
    const result = await api.POST('/api/admin/sessions', { body: { session: checked.fields! }, bodySerializer: formData })
    if (!result.ok) return failure("La session n'a pas pu être ajoutée", result)
    onAdded(result.session)
    return null
  })

  // The years' errors are about the days: the chosen day, and the one the session ends on.
  const startError = shown('day') ?? shown('start')
  const endError = shown('endDay') ?? shown('end')
  return (
    <form ref={formRef} className="admin-form calendar-new" aria-labelledby={headingId} onSubmit={submit} noValidate>
      <h3 id={headingId} ref={heading} className="calendar-heading" tabIndex={-1}>
        Nouvelle session
      </h3>
      {collectives.kind === 'error' && <CollectivesFailure message={collectives.message} />}
      <div className="admin-row admin-times">
        <div className="admin-field">
          <TimeInput label="Début" value={values.start} invalid={!!startError} onChange={(start) => update({ start })} onBlur={leave('start', 'day')} />
          <FieldError message={startError} />
        </div>
        <div className="admin-field">
          <TimeInput label="Fin" value={values.end} invalid={!!endError} onChange={(end) => update({ end })} onBlur={leave('end', 'endDay')} />
          <FieldError message={endError} />
        </div>
      </div>
      {checked.durationMinutes !== null && (
        <p className="admin-hint" role="status">
          Dure {formatDuration(checked.durationMinutes)}
          {checked.endsNextDay && ", jusqu'au lendemain"}.
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
      {values.type === 'other' && <NameField name={values.name} type={values.type} takeover={values.takeover} onChange={(name) => update({ name })} error={shown('name')} onLeave={leave('name')} />}
      <FormActions error={error} busy={busy} submitLabel="créer" onCancel={onCancel} />
    </form>
  )
}
