import { useId } from 'react'
import type { Application } from '../../application-fields'
import { Combobox } from '../../combobox'
import type { ComboboxOption } from '../../combobox'
import type { ApplicationLink } from '../../session-fields'
import { STATUS_LABELS, listedDates, receivedOn } from './describe'
import { FieldError } from './fields'

// The application a set or a session comes from, in their forms (see "Applications" in
// docs/design/client/admin/sessions.md).

const NO_APPLICATION: ComboboxOption = { key: '', label: 'Aucune candidature' }

// `text` with its first letter in upper case, e.g. "Reçue le 28 mars 2026" for "reçue le 28 mars 2026".
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

type ApplicationFieldProps = {
  // The applications that can be picked, in order: those of the set's performers, or of the takeover's collective.
  candidates: Application[]
  // Every application, or null when they couldn't be loaded.
  applications: Application[] | null
  // The set's or the session's application when the form opened, which stays among the options.
  own: ApplicationLink | null
  // The application picked, or null for none.
  selected: ApplicationLink | null
  // Who an application is for, as its label starts with in a set's form. In a session's, it's the takeover's collective,
  // which is left out.
  ownerName?: (application: Application) => string | undefined
  // What the field says while there's nothing to pick, e.g. before the set has performers, once the applications are
  // loaded.
  empty: string
  onChange: (application: ApplicationLink | null) => void
  error?: string
  onLeave: () => void
}

// The application picked among `candidates`, or none, or the one picked before, which stays among the options even when
// it isn't one of them anymore, e.g. once its artist is taken out of the set, so that what's wrong with it can be seen.
export function ApplicationField({ candidates, applications, own, selected, ownerName, empty, onChange, error, onLeave }: ApplicationFieldProps) {
  const id = useId()
  const optionOf = (link: ApplicationLink): ComboboxOption => {
    const application = applications?.find((application) => application.id === link.id)
    // When the applications couldn't be loaded, it's only named by when it was received.
    if (!application) return { key: link.id, label: capitalized(receivedOn(link)) }
    const name = ownerName?.(application)
    return {
      key: link.id,
      label: name ? `${name}, ${receivedOn(application)}` : capitalized(receivedOn(application)),
      detail: `${STATUS_LABELS[application.status]} · ${listedDates(application.dates)}`,
    }
  }
  const kept = [own, selected].filter(
    (link, i, links): link is ApplicationLink =>
      link !== null && !candidates.some(({ id }) => id === link.id) && links.findIndex((other) => other?.id === link.id) === i,
  )
  const options = [...kept, ...candidates].map(optionOf)
  // Without anything to pick, the field shows what it says instead, unless the applications couldn't be loaded, since
  // there might be some.
  if (options.length > 0 || applications === null) options.unshift(NO_APPLICATION)
  return (
    <div className="admin-field">
      <label htmlFor={id}>Candidature</label>
      <Combobox
        id={id}
        options={options}
        selected={selected?.id ?? ''}
        onSelect={(key) => {
          const link = [...kept, ...candidates].find((link) => link.id === key)
          onChange(link ? { id: link.id, receivedAt: link.receivedAt } : null)
        }}
        onBlur={onLeave}
        invalid={!!error}
        placeholder={empty}
      />
      {/* Announced, since changing another field, e.g. the set's performers, can make it wrong. */}
      <FieldError message={error} alert />
    </div>
  )
}
