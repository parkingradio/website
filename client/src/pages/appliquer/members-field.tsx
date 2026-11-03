import { useLayoutEffect, useRef } from 'react'
import { MAX_MEMBERS } from './choices'
import { emptyMember } from './members'
import type { Member, MemberErrors } from './members'
import { fieldId } from './profile'
import { IdentityFields, PresentationFields } from './profile-fields'

// The artists of a collective, each with their profile, as tabs above the profile of the one selected (see "Artistes du
// collectif" in docs/design/client/appliquer.md).

// Whether nothing was filled in a member's profile, which can then be taken out without asking.
function isEmpty({ name, country, city, genres, photo, bio, links }: Member): boolean {
  return (
    !name.trim() && !country && !city.trim() && genres.length === 0 && !photo && !bio.trim() && Object.values(links).every((link) => !link?.trim())
  )
}

// How a member is named, in their tab, their profile's legend and the button that takes them out.
function memberLabel(member: Member, index: number): string {
  const name = member.name.trim()
  return name ? `Artiste ${index + 1} — ${name}` : `Artiste ${index + 1}`
}

type Props = {
  members: Member[]
  onChange: (members: Member[]) => void
  // The index of the member whose profile is shown.
  selected: number
  onSelect: (index: number) => void
  // What's wrong with each member's profile, whether it's shown or not, which says whether it's complete.
  memberErrors: MemberErrors[]
  // Show the errors (set once the form was sent).
  showErrors: boolean
}

// Every member's profile is there, and only the selected one is shown, so that the others keep what they show, e.g. a
// link field that was added.
export function MembersField({ members, onChange, selected, onSelect, memberErrors, showErrors }: Props) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  // The element to focus once the members have changed: a new member's name, or the tab selected once one is taken out,
  // since the button that was clicked is gone.
  const focus = useRef<(() => HTMLElement | null) | null>(null)
  // In the commit that changes them, like every move of the focus (see LoadedSession in sessions.tsx).
  useLayoutEffect(() => {
    focus.current?.()?.focus()
    focus.current = null
  })

  const add = () => {
    const member = emptyMember(Math.max(...members.map((other) => other.key)) + 1)
    onChange([...members, member])
    onSelect(members.length)
    focus.current = () => document.getElementById(fieldId(idPrefix(member), 'nom'))
  }

  const remove = (index: number) => {
    const member = members[index]
    if (!isEmpty(member) && !window.confirm(`Enlever ${memberLabel(member, index)} du collectif ? Sa fiche sera effacée.`)) return
    onChange(members.filter((_, i) => i !== index))
    // The tab after the one taken out takes its place, or the one before when it was the last.
    const next = index < selected ? selected - 1 : Math.min(selected, members.length - 2)
    onSelect(next)
    focus.current = () => tabs.current[next]
  }

  return (
    <div className="member-tabs">
      <div className="member-tablist" role="group" aria-label="Artistes du collectif">
        {members.map((member, index) => {
          const complete = Object.keys(memberErrors[index] ?? {}).length === 0
          const wrong = showErrors && !complete
          const label = memberLabel(member, index)
          return (
            <div
              key={member.key}
              className={['member-tab', complete && 'done', wrong && 'invalid'].filter(Boolean).join(' ')}
              data-selected={index === selected || undefined}
            >
              <button
                ref={(element) => {
                  tabs.current[index] = element
                }}
                type="button"
                className="member-tab-select"
                aria-current={index === selected || undefined}
                aria-controls={profileId(member)}
                onClick={() => onSelect(index)}
              >
                <b aria-hidden="true">{index + 1}</b>
                <span className="member-tab-name" aria-hidden="true">
                  {member.name.trim() || `Artiste ${index + 1}`}
                </span>
                <span className="member-state" aria-hidden="true">
                  {complete ? '✓' : '○'}
                </span>
                <span className="visually-hidden">
                  {label}, {complete ? 'complet' : wrong ? 'à corriger' : 'à compléter'}
                </span>
              </button>
              {members.length > 1 && (
                <button type="button" className="member-tab-remove" aria-label={`Enlever ${label} du collectif`} onClick={() => remove(index)}>
                  <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                    <path d="M1 1l8 8M9 1 1 9" />
                  </svg>
                </button>
              )}
            </div>
          )
        })}
        {members.length < MAX_MEMBERS && (
          <button type="button" className="member-tab-add" onClick={add}>
            + ajouter un artiste ({members.length} / {MAX_MEMBERS})
          </button>
        )}
      </div>
      {members.map((member, index) => (
        <MemberProfile
          key={member.key}
          member={member}
          label={memberLabel(member, index)}
          hidden={index !== selected}
          errors={showErrors ? (memberErrors[index] ?? {}) : {}}
          showErrors={showErrors}
          onChange={(changed) => onChange(members.map((other) => (other.key === member.key ? changed : other)))}
        />
      ))}
    </div>
  )
}

function profileId(member: Member): string {
  return `membre-${member.key}`
}

// What the ids of the fields of a member's profile start with.
function idPrefix(member: Member): string {
  return `${profileId(member)}-`
}

type ProfileProps = {
  member: Member
  label: string
  hidden: boolean
  errors: MemberErrors
  showErrors: boolean
  onChange: (member: Member) => void
}

// A member's profile: the same fields as an artist who applies alone, in the same order, without the email and phone.
function MemberProfile({ member, label, hidden, errors, showErrors, onChange }: ProfileProps) {
  const update = (changes: Partial<Member>) => onChange({ ...member, ...changes })
  return (
    <fieldset className="member-panel" id={profileId(member)} hidden={hidden}>
      <legend className="visually-hidden">{label}</legend>
      <div className="fields">
        <IdentityFields idPrefix={idPrefix(member)} profile={member} onChange={update} errors={errors} />
        <PresentationFields idPrefix={idPrefix(member)} profile={member} onChange={update} errors={errors} showErrors={showErrors} />
      </div>
    </fieldset>
  )
}
