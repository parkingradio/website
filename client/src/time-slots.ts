// The programmation's time slots, in Québec time: artists pick from them on Appliquer, and the admin's session forms
// fill a session's times in from them (see docs/design/client/appliquer.md and docs/design/client/admin/sessions.md).
export const TIME_SLOTS = [
  { id: '11-15', label: '11 h – 15 h', start: '11:00', end: '15:00' },
  { id: '13-17', label: '13 h – 17 h', start: '13:00', end: '17:00' },
  { id: '18-22', label: '18 h – 22 h', start: '18:00', end: '22:00' },
] as const
export type TimeSlot = (typeof TIME_SLOTS)[number]
export type TimeSlotId = TimeSlot['id']
