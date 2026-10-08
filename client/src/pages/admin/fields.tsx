import type { ReactNode } from 'react'

// What the forms for artists and applications are made of.

// What's wrong with a field, under it.
export function FieldError({ message }: { message: string | null | undefined }) {
  return message ? <p className="admin-field-error">{message}</p> : null
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

// The error of the server, if it refused what was sent, then the button that sends the form, and the one that cancels
// it, if it can be.
export function FormActions({ error, busy, submitLabel, onCancel }: { error: string | null; busy: boolean; submitLabel: string; onCancel?: () => void }) {
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
