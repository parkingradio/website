// Helpers for the checks in artists.ts and applications.ts. What's wrong is said in French, since artists see it.

// The cleaned-up value of a field, or what's wrong with it.
export type Checked<T> = { value: T; error?: undefined } | { value?: undefined; error: string }

// What's wrong with each field of a `T` that isn't valid, in the order the fields were checked in, which `firstError`
// relies on. Fields that are fine are left out.
export type FieldErrors<T> = Partial<Record<keyof T, string>>

// The text in `value`, trimmed. `field` names it in the error when it's too long, e.g. "La bio", and `missing` is the
// error when there's none, if it's required.
export function checkText(value: unknown, field: string, maxLength: number, missing: string | null): Checked<string> {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed && missing) return { error: missing }
  if (trimmed.length > maxLength) return { error: `${field} dépasse ${maxLength} caractères.` }
  return { value: trimmed }
}

// Like `checkText`, for a field that's a single line, e.g. a name: each run of spaces, tabs or line breaks in it
// becomes a single space.
export function checkLine(value: unknown, field: string, maxLength: number, missing: string | null): Checked<string> {
  return checkText(typeof value === 'string' ? value.replace(/\s+/g, ' ') : value, field, maxLength, missing)
}

// The first of `errors`, e.g. to say what's wrong when only one thing can be said.
export function firstError<T>(errors: FieldErrors<T>): string {
  return Object.values<string | undefined>(errors).find(Boolean) ?? ''
}
