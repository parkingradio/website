import { useEffect, useId, useRef, useState } from 'react'
import type { Body } from '../../api/client'
import { BIO_MAX_LENGTH, CITY_MAX_LENGTH, EMAIL_MAX_LENGTH, NAME_MAX_LENGTH, PHONE_MAX_LENGTH, pickedPhotoError } from '../../artist-profile'
import type { Artist } from '../../artist-profile'
import { checkLine } from '../../checks'
import { checkCollectiveProfile } from '../../collective-profile'
import type { Collective, CollectiveProfile } from '../../collective-profile'
import { Combobox } from '../../combobox'
import { normalize } from '../../normalize'
import { detailOf, photoUrl } from './describe'
import { leaving, useCheckedForm } from './checked-form'
import { FieldError, FormActions, Labeled } from './fields'
import { CountryField, LinksField, PhotoField } from './profile-fields'
import type { GroupProps } from './profile-fields'

// A form for a collective's profile, members and photo, to add a collective or change one. Like the artist form (see
// artist-form.tsx), each field is checked as the server checks it for admins (see `checkCollectiveProfile`), and says
// what's wrong once it's been left, or once the form is sent, and the server's error is shown if it refuses the
// collective anyway.

// A member: an artist who exists, with their id, or a new one, whom the server creates with this name.
type Member = { id: string; name: string } | { name: string }
type FormProfile = Omit<CollectiveProfile, 'members'> & { members: Member[] }

const EMPTY: FormProfile = { name: '', members: [], country: 'CA', city: '', description: '', links: {}, email: '', phone: '' }

type Field = keyof CollectiveProfile | 'photo'

// The member with this name, whatever its case and accents, if there's one.
function memberNamed(members: Member[], name: string): Member | undefined {
  return members.find((member) => normalize(member.name) === normalize(name))
}

export type CollectiveFormProps = {
  // The collective to change, or nothing for a new one.
  collective?: Collective
  // Every artist, of whom members are picked, or null when they couldn't be loaded, which leaves only adding new ones.
  artists: Artist[] | null
  submitLabel: string
  // Sends the form, as `PUT /api/admin/collectives/:id` takes it, which `POST /api/admin/collectives` takes too, without
  // `removePhoto`, and returns the error, if it failed.
  onSubmit: (body: Body<'put', '/api/admin/collectives/{id}'>) => Promise<string | null>
  onCancel?: () => void
}

export function CollectiveForm({ collective: initial, artists, submitLabel, onSubmit, onCancel }: CollectiveFormProps) {
  const [profile, setProfile] = useState<FormProfile>(initial ?? EMPTY)
  const [photo, setPhoto] = useState<File | null>(null)
  // Whether to remove the collective's photo, which only happens once the form is sent.
  const [removePhoto, setRemovePhoto] = useState(false)
  // The name of a new artist being typed, before it's added.
  const [memberEntry, setMemberEntry] = useState('')

  const checked = checkCollectiveProfile(profile)
  const errors: Partial<Record<Field, string>> = { ...checked.errors }
  // Only the names added are sent. One that's left typed would be lost, so it has to be added (or cleared) first, unless
  // it's a member's already, which can't be added again.
  const unpinned = memberEntry.trim()
  if (unpinned) {
    errors.members = memberNamed(profile.members, unpinned)
      ? `« ${unpinned} » est déjà parmi les artistes du collectif : effacez ce nom.`
      : `« ${unpinned} » n'est pas ajouté : appuyer sur + pour l'ajouter.`
  }
  const photoProblem = pickedPhotoError(photo)
  if (photoProblem) errors.photo = photoProblem
  const { form, submit, busy, error, submitted, shown, leave } = useCheckedForm(errors, () =>
    // There's a profile, since there are no errors by then.
    onSubmit({ collective: checked.profile!, photo: photo ?? undefined, removePhoto: !photo && removePhoto ? 'true' : undefined }),
  )
  const update = (changes: Partial<FormProfile>) => setProfile((profile) => ({ ...profile, ...changes }))

  // The props of the input of a field of the profile that's a single value.
  const input = (field: 'name' | 'city' | 'description' | 'email' | 'phone') => ({
    value: profile[field],
    'aria-invalid': shown(field) ? true : undefined,
    onChange: (event: { target: { value: string } }) => update({ [field]: event.target.value }),
    onBlur: leave(field),
  })

  return (
    <form ref={form} className="admin-form admin-form-wide" onSubmit={submit} noValidate>
      <Labeled label="Nom du collectif" error={shown('name')}>
        <input {...input('name')} maxLength={NAME_MAX_LENGTH} required />
      </Labeled>

      <MembersField
        members={profile.members}
        artists={artists}
        onChange={(members) => update({ members })}
        entry={memberEntry}
        onEntryChange={setMemberEntry}
        error={shown('members')}
        onLeave={leave('members')}
      />

      <CountryField
        country={profile.country}
        onChange={(country) => update({ country: country as FormProfile['country'] })}
        error={shown('country')}
        onLeave={leave('country')}
      />

      <Labeled label="Ville" error={shown('city')}>
        <input {...input('city')} maxLength={CITY_MAX_LENGTH} />
      </Labeled>

      <Labeled label="Description" error={shown('description')}>
        <textarea {...input('description')} rows={8} maxLength={BIO_MAX_LENGTH} />
      </Labeled>

      <LinksField links={profile.links} onChange={(links) => update({ links })} showAll={submitted} onLeave={leave('links')} />

      <Labeled label="Adresse e-mail du contact" error={shown('email')}>
        <input type="email" {...input('email')} maxLength={EMAIL_MAX_LENGTH} required />
      </Labeled>

      <Labeled label="Téléphone du contact" error={shown('phone')}>
        <input type="tel" {...input('phone')} maxLength={PHONE_MAX_LENGTH} />
      </Labeled>

      <PhotoField
        current={initial?.hasPhoto ? photoUrl('collectives', initial) : null}
        removed={removePhoto}
        onRemove={() => setRemovePhoto(true)}
        photo={photo}
        onChange={(photo) => {
          setPhoto(photo)
          leave('photo')()
        }}
        error={shown('photo')}
      />

      <FormActions error={error} busy={busy} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  )
}

// The collective's artists, in order, each of whom can be moved up or down or removed, then the two ways of adding one:
// picking one of the known artists, or typing the name of a new one (`entry`), then adding it with + or Enter. Only the
// names added are sent, so a name left typed is an error, which the form says. A name that's a member's already can't be
// added again.
function MembersField({
  members,
  artists,
  onChange,
  entry,
  onEntryChange,
  error,
  onLeave,
}: GroupProps<Member[]> & { members: Member[]; artists: Artist[] | null; entry: string; onEntryChange: (entry: string) => void }) {
  const pickerId = useId()
  const entryId = useId()
  const list = useRef<HTMLOListElement>(null)
  // What gets the focus once the members change, since the button that changed them can be gone, disabled or moved,
  // which loses it: a button of a member, by their key, or else the field that adds one.
  const focusNext = useRef<{ key: string; action: 'up' | 'down' | 'remove' } | 'add' | null>(null)
  useEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === 'add') document.getElementById(artists ? pickerId : entryId)?.focus()
    else if (next) {
      const item = Array.from(list.current?.children ?? []).find((item) => (item as HTMLElement).dataset.member === next.key)
      item?.querySelector<HTMLElement>(`[data-action="${next.action}"]`)?.focus()
    }
  }, [members, artists, pickerId, entryId])

  // Neither the collective's artists, nor the artists whose `kind` is "collective", who can't be members.
  const options = (artists ?? [])
    .filter((artist) => artist.kind === 'artist' && !members.some((member) => 'id' in member && member.id === artist.id))
    .map((artist) => ({ key: artist.id, label: artist.name, detail: detailOf(artist) }))
  // A name left typed is what's wrong with the members, if anything is, or else that there are none.
  const pending = entry.trim() !== ''
  // A member with the name typed, or else an artist, who could be picked rather than having another one created.
  const member = pending ? memberNamed(members, entry) : undefined
  const namesake =
    pending && !member ? artists?.find((artist) => artist.kind === 'artist' && normalize(artist.name) === normalize(entry)) : undefined

  const pick = (id: string) => {
    const artist = artists?.find((artist) => artist.id === id)
    if (artist) onChange([...members, { id, name: artist.name }])
  }
  const add = () => {
    // The input's maxLength keeps the name short enough; a name with the NUL character, which the server refuses, is
    // dropped. One that's a member's already stays typed, and the field says why.
    const { value } = checkLine(entry, "Le nom d'un artiste du collectif", NAME_MAX_LENGTH, null)
    if (value && memberNamed(members, value)) return
    if (value) onChange([...members, { name: value }])
    onEntryChange('')
  }
  const move = (index: number, by: number) => {
    const moved = [...members]
    ;[moved[index], moved[index + by]] = [moved[index + by], moved[index]]
    // The same arrow, unless the member is now at the end where it's disabled.
    const [arrow, other] = by < 0 ? (['up', 'down'] as const) : (['down', 'up'] as const)
    const end = by < 0 ? 0 : members.length - 1
    focusNext.current = { key: keyOf(members[index]), action: index + by === end ? other : arrow }
    onChange(moved)
  }
  const remove = (index: number) => {
    const next = members[index + 1]
    focusNext.current = next ? { key: keyOf(next), action: 'remove' } : 'add'
    onChange(members.filter((_, i) => i !== index))
  }

  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Artistes du collectif</legend>
      <p className="admin-hint">Dans leur ordre de présentation. Les genres du collectif sont ceux de ses artistes.</p>
      {members.length > 0 && (
        <ol ref={list} className="admin-chosen admin-members">
          {members.map((member, index) => (
            <li key={keyOf(member)} data-member={keyOf(member)}>
              <b>{index + 1}</b>
              {'id' in member ? member.name : `${member.name} (nouveau)`}
              <button type="button" data-action="up" aria-label={`monter ${member.name}`} disabled={index === 0} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button
                type="button"
                data-action="down"
                aria-label={`descendre ${member.name}`}
                disabled={index === members.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button type="button" data-action="remove" aria-label={`retirer ${member.name}`} onClick={() => remove(index)}>
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="admin-field">
        <label htmlFor={pickerId}>Ajouter un artiste connu</label>
        <Combobox
          id={pickerId}
          options={options}
          selected={null}
          onSelect={pick}
          placeholder={artists ? 'choisir un artiste…' : "les artistes n'ont pas pu être chargés"}
          disabled={!artists}
          invalid={!!error && !pending}
        />
      </div>
      <div className="admin-field">
        <label htmlFor={entryId}>Ajouter un nouvel artiste</label>
        <div className="admin-row">
          <input
            id={entryId}
            aria-invalid={error && pending ? true : undefined}
            value={entry}
            maxLength={NAME_MAX_LENGTH}
            onChange={(event) => onEntryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                // Adds the name rather than sending the form.
                event.preventDefault()
                add()
              }
            }}
          />
          <button type="button" aria-label="ajouter ce nouvel artiste au collectif" onClick={add}>
            +
          </button>
        </div>
        {/* Until the field is left, after which the error says so. */}
        {member && !error && <p className="admin-hint">«&nbsp;{member.name}&nbsp;» est déjà parmi les artistes du collectif.</p>}
        {namesake && (
          <p className="admin-hint">
            Un artiste s'appelle déjà «&nbsp;{namesake.name}&nbsp;»&nbsp;: le choisir parmi les artistes connus évite de créer un doublon.
          </p>
        )}
        <p className="admin-hint">Il est créé avec ce nom seulement, à l'enregistrement du collectif.</p>
      </div>
      <FieldError message={error} />
    </fieldset>
  )
}

// What tells members apart, e.g. as React's keys.
function keyOf(member: Member): string {
  return 'id' in member ? `id:${member.id}` : `name:${normalize(member.name)}`
}
