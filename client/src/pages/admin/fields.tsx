import { useId } from 'react'
import type { ReactNode } from 'react'
import { OTHER_PERFORMANCE_TYPE_MAX_LENGTH, PERFORMANCE_TYPES, performanceTypeName } from '../../application-fields'
import type { PerformanceTypeId } from '../../application-fields'
import type { Duration } from '../../session-fields'

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

// A number of hours and minutes, e.g. a duration, as two numbers, rather than as a time of day, which browsers can show as
// AM or PM. It's named `label`, with what's wrong with it under it. It's part of a group of fields that's left as a whole.
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
  const input = (part: keyof Duration, max: number) => (
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
          {input('hours', 99)}
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

// The error of the server, if it refused what was sent, then the button that sends the form, and the one that cancels
// it, if it can be.
export function FormActions({ error, busy, submitLabel, onCancel }: { error: ReactNode; busy: boolean; submitLabel: string; onCancel?: () => void }) {
  return (
    <>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-actions">
        <button type="submit" disabled={busy}>
          {submitLabel}
        </button>
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
