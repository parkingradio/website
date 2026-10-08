import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, FormEvent } from 'react'

// How the forms for artists and applications check their fields and send them.

// A blur handler that calls `onLeave` once the focus leaves the element and everything in it, rather than moving
// within it, e.g. from one of a fieldset's inputs to another.
export function leaving(onLeave: () => void) {
  return (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onLeave()
  }
}

// A form whose fields say what's wrong with them (`errors`) once they've been left, or once the form is sent. Sending
// it with errors brings the first field to fix (the first marked aria-invalid) into focus, rather than calling `send`,
// which returns the error to show if sending failed. On success, whoever shows the form moves on from it.
export function useCheckedForm<Field extends string>(errors: Partial<Record<Field, string>>, send: () => Promise<string | null>) {
  const form = useRef<HTMLFormElement>(null)
  // The fields that have been left, whose errors are shown. Once the form is sent, every error is.
  const [left, setLeft] = useState<Set<Field>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  // Counts the attempts to send the form with errors, to bring the first field to fix into focus after each one.
  const [attempts, setAttempts] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (attempts > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [attempts])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length > 0) {
      setAttempts((attempts) => attempts + 1)
      return
    }
    setBusy(true)
    setError(null)
    const failure = await send()
    if (failure !== null) {
      setBusy(false)
      setError(failure)
    }
  }

  return {
    form,
    submit,
    busy,
    error,
    // Whether every error is shown, rather than only those of the fields that have been left.
    submitted,
    // What's wrong with `field`, once it's to be shown.
    shown: (field: Field) => (submitted || left.has(field) ? errors[field] : undefined),
    // A handler that notes that `field` has been left.
    leave: (field: Field) => () => setLeft((left) => new Set(left).add(field)),
  }
}
