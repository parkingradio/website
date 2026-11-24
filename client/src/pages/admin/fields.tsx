import { useEffect, useEffectEvent, useId, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { parseTime } from '@internationalized/date'
import type { Time } from '@internationalized/date'
import { DateInput, DateSegment, I18nProvider, Label, TimeField } from 'react-aria-components'
import type { DateFieldState } from 'react-aria-components'
import { OTHER_PERFORMANCE_TYPE_MAX_LENGTH, PERFORMANCE_TYPES, isTime, performanceTypeName } from '../../application-fields'
import type { PerformanceTypeId } from '../../application-fields'
import type { Duration } from '../../session-fields'
import { Button } from './button'

// What the forms of the admin sections are made of.

// What's wrong with a field, under it. `alert` for an error that shows while the focus stays on the field, e.g. a photo's
// as soon as it's chosen, for screen readers to announce it.
export function FieldError({ message, alert = false }: { message: string | null | undefined; alert?: boolean }) {
  return message ? (
    <p className="admin-field-error" role={alert ? 'alert' : undefined}>
      {message}
    </p>
  ) : null
}

// A field with its label around it, and what's wrong with it under it.
export function Labeled({ label, error, children }: { label: string; error: string | null | undefined; children: ReactNode }) {
  return (
    <div className="admin-field">
      <label>
        {label}
        {children}
      </label>
      <FieldError message={error} />
    </div>
  )
}

// A number of hours and minutes, e.g. a duration, as two numbers, rather than as a time of day, since it can be longer
// than a day. It's named `label`, with what's wrong with it under it. It's part of a group of fields that's left as a whole.
export function DurationField({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: Duration
  onChange: (value: Duration) => void
  error: string | undefined
}) {
  const id = useId()
  const input = (part: keyof Duration, max?: number) => (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      value={value[part]}
      aria-invalid={error ? true : undefined}
      onChange={(event) => onChange({ ...value, [part]: event.target.value })}
    />
  )
  return (
    <div className="admin-field">
      <span id={id}>{label}</span>
      <div className="admin-row admin-times admin-duration" role="group" aria-labelledby={id}>
        <label>
          heures
          {input('hours')}
        </label>
        <label>
          minutes
          {input('minutes', 59)}
        </label>
      </div>
      <FieldError message={error} />
    </div>
  )
}

// A time of day, in the 24-hour format, e.g. "21 h 30", whatever the browser (see docs/design/client/architecture.md):
// its hour and its minute, which are typed. Its value is "HH:MM", or "" while either is empty, like a native time field's.
// It's named `label`, above it, or else `aria-label`. `onBlur` is called once the focus leaves the field, rather than
// when it moves from its hour to its minute.
export function TimeInput({
  value,
  onChange,
  label,
  'aria-label': ariaLabel,
  invalid = false,
  onBlur,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  'aria-label'?: string
  invalid?: boolean
  onBlur?: () => void
}) {
  // The time React Aria is given. It shows it again whenever it changes, so while a part is empty, this stays the last
  // complete time, rather than none, which would empty the part that's still there.
  const [time, setTime] = useState(() => toTime(value))
  // The value the field had last: the one it said it had, or the form's.
  const [last, setLast] = useState(value)
  // The form changed it, e.g. filling the end in from the start. This is done while rendering: an effect would run after
  // the field had said what it shows, still the old time, which would undo the form's change.
  if (value !== last) {
    setLast(value)
    setTime(toTime(value))
  }
  const shown = (shown: string) => {
    if (shown === last) return
    setLast(shown)
    onChange(shown)
  }
  return (
    <I18nProvider locale="fr-CA">
      <TimeField
        className="admin-time"
        hourCycle={24}
        validationBehavior="aria"
        value={time}
        onChange={setTime}
        isInvalid={invalid}
        aria-label={ariaLabel}
        onBlur={onBlur}
        onKeyDown={submitOnEnter}
      >
        {({ state }) => (
          <>
            {label && <Label>{label}</Label>}
            <DateInput className="admin-time-input">
              {(segment) => <DateSegment segment={segment} />}
            </DateInput>
            <ShownTime segments={state.segments} onShown={shown} />
          </>
        )}
      </TimeField>
    </I18nProvider>
  )
}

const toTime = (value: string): Time | null => (isTime(value) ? parseTime(value) : null)

// Says what a time field shows, as "HH:MM", or "" while its hour or its minute is empty, which React Aria doesn't: it
// keeps the last complete time.
function ShownTime({ segments, onShown }: { segments: DateFieldState['segments']; onShown: (shown: string) => void }) {
  const parts = segments.filter((segment) => segment.isEditable)
  const shown = parts.some((segment) => segment.isPlaceholder) ? '' : parts.map((segment) => String(segment.value).padStart(2, '0')).join(':')
  const say = useEffectEvent(onShown)
  useEffect(() => say(shown), [shown])
  return null
}

// Enter in a time field sends its form, as in a native field, by clicking the form's default button, so that it doesn't
// while that button is disabled, or greyed out (see Button).
function submitOnEnter(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter') return
  const form = event.currentTarget.closest('form')
  const button = form && [...form.elements].find((element): element is HTMLButtonElement => element instanceof HTMLButtonElement && element.type === 'submit')
  if (!button) return
  event.preventDefault()
  button.click()
}

// The error of the server, if it refused what was sent, then the button that sends the form, and the one that cancels
// it, if it can be.
export function FormActions({
  error,
  busy,
  submitLabel,
  onCancel,
  form,
  unavailable,
}: {
  error: ReactNode
  busy: boolean
  submitLabel: string
  onCancel?: () => void
  // The id of the form it sends, when it isn't within it.
  form?: string
  // Why the form can't be sent, when a rule keeps it from being sent.
  unavailable?: string | null
}) {
  return (
    <>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-actions">
        <Button type="submit" form={form} disabled={busy} unavailable={unavailable}>
          {submitLabel}
        </Button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            annuler
          </button>
        )}
      </div>
    </>
  )
}

// What an artist would do, or did, e.g. in an application or a set: performance types from the list, in any order, and
// anything else, in a few words ("Autre"), whose error is `error`, shown once it's left.
export function PerformanceTypesField({
  performanceTypes,
  otherPerformanceType,
  onChange,
  onOtherChange,
  error,
  onLeave,
}: {
  performanceTypes: PerformanceTypeId[]
  otherPerformanceType: string
  onChange: (performanceTypes: PerformanceTypeId[]) => void
  onOtherChange: (otherPerformanceType: string) => void
  error: string | undefined
  onLeave: () => void
}) {
  return (
    <fieldset className="admin-fields">
      <legend>Type de prestation</legend>
      <div className="admin-choices">
        {PERFORMANCE_TYPES.map((id) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={performanceTypes.includes(id)}
              onChange={(event) => onChange(event.target.checked ? [...performanceTypes, id] : performanceTypes.filter((other) => other !== id))}
            />
            {performanceTypeName(id)}
          </label>
        ))}
      </div>
      <Labeled label="Autre" error={error}>
        <input
          placeholder="en quelques mots"
          value={otherPerformanceType}
          maxLength={OTHER_PERFORMANCE_TYPE_MAX_LENGTH}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onOtherChange(event.target.value)}
          onBlur={onLeave}
        />
      </Labeled>
    </fieldset>
  )
}
