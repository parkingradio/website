import { isTime } from '../../../application-fields'
import type { FieldErrors } from '../../../checks'
import { addDays } from '../../../quebec-time'
import { EMPTY_SESSION_FORM, checkSession, pickedSlot, sessionTimes } from '../../../session-fields'
import type { Reference, SessionFields, SessionFormValues, SessionType } from '../../../session-fields'
import type { TimeSlotId } from '../../../time-slots'

// The short form for a new session on Calendrier's chosen day, without React (see "A new session" in
// docs/design/client/admin/calendrier.md): it's checked as the session form checks a session (see `checkSession`).

// A new session as the form has it: its times of day, its type, its takeover's collective, which it keeps while another
// type is picked, like the session form, and its name, likewise.
export type NewSessionOnDay = { start: string; end: string; type: SessionType | null; takeover: Reference | null; name: string }

// The new session on `day` as the session form has it. It ends on `day` when its end's time is after its start's, and
// otherwise the next day. Only "Autre" has a name, since the form only shows it for "Autre".
function sessionOnDay(day: string, { start, end, type, takeover, name }: NewSessionOnDay): SessionFormValues {
  const endDay = isTime(start) && isTime(end) && end < start ? addDays(day, 1) : day
  return { ...EMPTY_SESSION_FORM, day, lastDay: day, start, endDay, end, type, takeover, name: type === 'other' ? name : '' }
}

// Checks the new session on `day`, and returns what the server would be sent, or what's wrong with each field, along with
// how long the session lasts and whether it ends the next day, once its times are valid, and the time slot that's picked,
// if any. Equal times are refused, even on the night the clocks go back, when the second one is an hour after the first.
export function checkSessionOnDay(
  day: string,
  values: NewSessionOnDay,
): { fields?: SessionFields; errors?: FieldErrors<SessionFormValues>; durationMinutes: number | null; endsNextDay: boolean; slot: TimeSlotId | null } {
  const form = sessionOnDay(day, values)
  let times = sessionTimes(form)
  if (isTime(values.start) && values.start === values.end) times = { errors: { ...('errors' in times && times.errors), end: 'La fin doit être après le début.' } }
  const durationMinutes = 'errors' in times ? null : times.durationMinutes
  return { ...checkSession(form, times), durationMinutes, endsNextDay: durationMinutes !== null && form.endDay !== day, slot: pickedSlot(form) }
}
