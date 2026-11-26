import { useId } from 'react'
import type { Application } from '../../application-fields'
import { Combobox } from '../../combobox'
import type { ComboboxOption } from '../../combobox'
import { applicationLink } from '../../session-fields'
import type { ApplicationLink } from '../../session-fields'
import { STATUS_LABELS, capitalized, listedDates, receivedOn } from './describe'

// The application a set or a session comes from, in their forms (see "Applications" in
// docs/design/client/admin/sessions.md).

const NO_APPLICATION: ComboboxOption = { key: '', label: 'Aucune candidature' }

type ApplicationFieldProps = {
  // The applications that can be picked, in order: those of the set's performers, or of the takeover's collective.
  candidates: Application[]
  // Every application, or null when they couldn't be loaded.
  applications: Application[] | null
  // The set's or the session's application when the form opened, which is offered when the applications couldn't be
  // loaded.
  own: ApplicationLink | null
  // The application picked, or null for none.
  selected: ApplicationLink | null
  // Whether the set or the session is cancelled: only then can a rejected application be picked, which is greyed out
  // otherwise (see "Applications" in docs/design/server/sessions.md).
  cancelled: boolean
  // Who an application is for, as its label starts with in a set's form. In a session's, it's the takeover's collective,
  // which is left out.
  ownerName?: (application: Application) => string | undefined
  // What the field says while there's nothing to pick, e.g. before the set has performers, once the applications are
  // loaded.
  empty: string
  onChange: (application: ApplicationLink | null) => void
}

// The application picked among `candidates`, or none, or among the set's or the session's own and none when the
// applications couldn't be loaded.
export function ApplicationField({ candidates, applications, own, selected, cancelled, ownerName, empty, onChange }: ApplicationFieldProps) {
  const id = useId()
  const optionOf = (application: Application): ComboboxOption => {
    const name = ownerName?.(application)
    return {
      key: application.id,
      label: name ? `${name}, ${receivedOn(application)}` : capitalized(receivedOn(application)),
      detail: `${STATUS_LABELS[application.status]} · ${listedDates(application.dates)}`,
      unavailable: application.decision === 'rejected' && !cancelled,
    }
  }
  // When the applications couldn't be loaded, only its own can be picked, named by when it was received.
  const choices: ApplicationLink[] = applications ? candidates : own ? [own] : []
  const options = applications ? candidates.map(optionOf) : choices.map((link) => ({ key: link.id, label: capitalized(receivedOn(link)) }))
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
          const link = choices.find((link) => link.id === key)
          onChange(link ? applicationLink(link) : null)
        }}
        placeholder={empty}
      />
    </div>
  )
}
