// Helpers for the client's copies of the server's rules (see artist-profile.ts and application-fields.ts). What's wrong is
// said in French, since artists see it.
//
// They're copies of how the server checks text (see `text` and `line` in server/src/artists/profile.ts), and must be
// changed together with it.

// The cleaned-up value of a field, or what's wrong with it.
export type Checked<T> = { value: T; error?: undefined } | { value?: undefined; error: string }

// What's wrong with each field of a `T` that isn't valid, in the order the fields were checked in, which is the order of
// the server's checks, which answer with the first error. Fields that are fine are left out.
export type FieldErrors<T> = Partial<Record<keyof T, string>>

// The text in `value`, trimmed, and refused if it has the NUL character, like the server does. `field` names it in the
// error when it's too long or has a NUL, e.g. "La bio", and `missing` is the error when there's none, if it's required.
export function checkText(value: unknown, field: string, maxLength: number, missing: string | null): Checked<string> {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed && missing) return { error: missing }
  if (trimmed.includes('\0')) return { error: `${field} contient un caractère invalide.` }
  if (trimmed.length > maxLength) return { error: `${field} dépasse ${maxLength} caractères.` }
  return { value: trimmed }
}

// Like `checkText`, for a field that's a single line, e.g. a name: each run of spaces, tabs or line breaks in it
// becomes a single space.
export function checkLine(value: unknown, field: string, maxLength: number, missing: string | null): Checked<string> {
  return checkText(typeof value === 'string' ? value.replace(/\s+/g, ' ') : value, field, maxLength, missing)
}

// The list of every `T`, e.g. a copy of one of the server's lists: the compiler refuses a value that isn't a `T`, and says
// which are missing.
export function everyOne<T extends string>() {
  return <const List extends readonly T[]>(list: List & ([Exclude<T, List[number]>] extends [never] ? unknown : { missing: Exclude<T, List[number]> })) =>
    list
}
