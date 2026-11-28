import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { Schema } from '../../api/client'
import { useApi } from '../../api/use-api'
import { useTabShownCount } from '../../api/use-tab-shown'
import { Combobox } from '../../combobox'
import type { ComboboxFilter, ComboboxOption } from '../../combobox'
import { QUEBEC_TIME_ZONE } from '../../quebec-time'
import { byWhom, capitalized, formatDuration, sessionLongDay, sessionName, setInSentence, setName } from './describe'
import { search } from './list'
import { OrderedList } from './ordered-list'
import { sessionPath } from './session-errors'
import { Performers, SetLinks } from './set-cells'

// The radio's rotation of sets, from the set on air, and changing it (see docs/design/client/admin/rotation.md).

type RadioRotation = Schema<'RadioRotation'>
type SkipReason = Schema<'RotationSkipReason'>
// A set of the rotation, or one that can be added to it, with why it's skipped (never, for one that can be added).
type Listed = Schema<'RotationCandidate'> & Pick<Schema<'RotationSet'>, 'skipped'>

// When the sets go on air, in Québec time, like everything the admin pages show (see docs/design/client/admin/layout.md),
// as on the legacy page (see rotation-legacy.tsx).
const timeFormat = new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: QUEBEC_TIME_ZONE })
const dayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: QUEBEC_TIME_ZONE })

// Why a set is skipped, or can't be added (see "Which sets" in docs/design/server/radio.md).
const SKIP_REASONS: Record<SkipReason, string> = {
  cancelled: 'le set est annulé',
  'no-soundcloud-track': "le set n'a pas de piste sur SoundCloud",
  'no-youtube-video': "le set n'a pas de vidéo sur YouTube",
  'not-announced': "la session n'est pas annoncée",
  unread: "la piste n'a pas encore été lue sur SoundCloud",
  missing: 'SoundCloud ne montre plus de piste à ce lien',
  unexpected: 'SoundCloud décrit la piste de façon inattendue',
  preview: 'seul un extrait de 30 secondes de la piste peut être joué',
  blocked: 'la piste ne peut pas être jouée',
  'not-streamable': 'la piste ne peut pas être lue en streaming',
}

const reasonsText = (reasons: SkipReason[]) => reasons.map((reason) => SKIP_REASONS[reason]).join(', ')

// How long after the set on air ends the rotation is loaded again, so that the server has moved on by then, and how long
// after it was last loaded at the soonest, so that a browser whose clock is ahead of the server's doesn't load it again
// and again until the server's clock gets there.
const AFTER_END_MS = 2 * 1000
const MIN_RELOAD_MS = 10 * 1000

// When the set on air ends, or null when the radio is off air.
function onAirEnds({ current, sets }: RadioRotation): number | null {
  const durationMs = current && sets.find((set) => set.id === current.setId)?.durationMs
  return current && durationMs ? Date.parse(current.startedAt) + durationMs : null
}

// The rotation, loaded again when the set on air ends and when the tab is shown again, and why it last failed to load,
// if it did, which leaves what was loaded before. `saved` replaces it with what saving it answered. Only the answer of
// the last request counts, so that one that was sent before it was saved doesn't take its place.
function useRotation(): { rotation: RadioRotation | null; error: string | null; saved: (rotation: RadioRotation) => void } {
  const [loaded, setLoaded] = useState<{ rotation: RadioRotation | null; error: string | null }>({ rotation: null, error: null })
  const [ended, setEnded] = useState(0)
  const tabShown = useTabShownCount()
  const latest = useRef(0)

  useEffect(() => {
    const request = ++latest.current
    api.GET('/api/admin/radio/rotation').then((result) => {
      if (request !== latest.current) return
      if (result.ok) setLoaded({ rotation: result, error: null })
      else setLoaded((loaded) => ({ ...loaded, error: result.error }))
    })
  }, [ended, tabShown])

  // Again after each answer, even one that failed, so that the page catches up once the server can be reached again.
  useEffect(() => {
    const ends = loaded.rotation && onAirEnds(loaded.rotation)
    if (ends === null) return
    const timer = setTimeout(() => setEnded((count) => count + 1), Math.max(ends + AFTER_END_MS - Date.now(), MIN_RELOAD_MS))
    return () => clearTimeout(timer)
  }, [loaded])

  const saved = (rotation: RadioRotation) => {
    latest.current++
    setLoaded({ rotation, error: null })
  }
  return { ...loaded, saved }
}

// The rotation's sets in the order they come on air: from the one on air, around the rotation, or in its order when the
// radio is off air.
function shownOrder({ current, sets }: RadioRotation): Schema<'RotationSet'>[] {
  const at = current ? sets.findIndex((set) => set.id === current.setId) : -1
  return at <= 0 ? sets : [...sets.slice(at), ...sets.slice(0, at)]
}

export function Rotation() {
  const { rotation, error, saved } = useRotation()
  const credentials = useApi('/api/admin/radio/credentials')
  const [editing, setEditing] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)
  // « modifier » gets the focus back once the rotation is no longer being changed.
  const modify = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(editing)
  useEffect(() => {
    if (wasEditing.current && !editing) modify.current?.focus()
    wasEditing.current = editing
  }, [editing])

  const updated = rotation && byWhom('Modifiée', rotation.updatedBy, rotation.updatedAt)
  return (
    <>
      <h1>Rotation radio</h1>
      {credentials.kind === 'loaded' && credentials.value.credentials === null && (
        <p className="admin-error" role="alert">
          La radio ne peut lire aucune piste sur SoundCloud tant que les identifiants de son application n'ont pas été entrés
          dans la <Link to="/admin/configuration">configuration</Link>.
        </p>
      )}
      {updated && <p className="admin-meta">{updated}</p>}
      {rotation === null ? (
        error && (
          <p className="admin-error" role="alert">
            La rotation n'a pas pu être chargée&nbsp;: {error}
          </p>
        )
      ) : (
        <>
          {error && (
            <p className="admin-error" role="alert">
              La rotation n'a pas pu être chargée à nouveau&nbsp;: {error}
            </p>
          )}
          {savedNotice && (
            <p className="admin-notice" role="status">
              La rotation a été enregistrée.
            </p>
          )}
          {editing ? (
            <EditRotation
              rotation={rotation}
              onCancel={() => setEditing(false)}
              onSaved={(rotation) => {
                saved(rotation)
                setSavedNotice(true)
                setEditing(false)
              }}
            />
          ) : (
            <>
              <div className="admin-toolbar">
                <button
                  ref={modify}
                  type="button"
                  onClick={() => {
                    setSavedNotice(false)
                    setEditing(true)
                  }}
                >
                  modifier
                </button>
              </div>
              <RotationSets rotation={rotation} />
            </>
          )}
        </>
      )}
    </>
  )
}

// The rotation's sets, from the set on air, each one that isn't skipped with when it goes on air, and the day before it
// whenever it changes, as on the legacy page.
function RotationSets({ rotation }: { rotation: RadioRotation }) {
  if (rotation.sets.length === 0) return <p className="admin-placeholder">La rotation est vide&nbsp;: la radio est hors ondes.</p>
  const rows: { set: Schema<'RotationSet'>; startsAt: number | null; day: string | null }[] = []
  let day: string | null = null
  for (const set of shownOrder(rotation)) {
    const startsAt = set.startsAt === null ? null : Date.parse(set.startsAt)
    const startsOn = startsAt === null ? null : dayFormat.format(startsAt)
    rows.push({ set, startsAt, day: day !== null && startsOn !== day ? startsOn : null })
    day = startsOn ?? day
  }
  return (
    <>
      {rotation.sets.every((set) => set.skipped.length > 0) && (
        <p className="admin-placeholder">Aucun set de la rotation ne peut être diffusé&nbsp;: la radio est hors ondes.</p>
      )}
      <ol className="radio-tracks rotation-sets">
        {rows.map(({ set, startsAt, day }) => (
          <Fragment key={set.id}>
            {day && <li className="radio-tracks-day">{day}</li>}
            <RotationSet set={set} startsAt={startsAt} onAir={set.id === rotation.current?.setId} />
          </Fragment>
        ))}
      </ol>
    </>
  )
}

function RotationSet({ set, startsAt, onAir }: { set: Schema<'RotationSet'>; startsAt: number | null; onAir: boolean }) {
  const skipped = set.skipped.length > 0
  return (
    <li className={skipped ? 'rotation-set-skipped' : onAir ? 'rotation-set-current' : undefined}>
      <span className="radio-track-time">{startsAt === null ? '' : timeFormat.format(startsAt)}</span>
      <div className="rotation-set">
        <p className="rotation-set-performers">
          {set.performers.length > 0 ? <Performers performers={set.performers} /> : 'Set'}
          {onAir && <OnAirTag />}
        </p>
        <p>
          <Link to={sessionPath(set.session)}>{sessionName(set.session)}</Link>
          {set.durationMs !== null && ` · ${formatDuration(Math.round(set.durationMs / 60000))}`}
          {(set.soundcloudTrack || set.youtubeVideo) && ' · '}
          <SetLinks set={{ ...set, application: null }} />
        </p>
        <SetState set={set} />
      </div>
    </li>
  )
}

const OnAirTag = () => <span className="radio-track-tag">en cours</span>

// Why a set is skipped, if it is, and why the last read of its track failed, if it did.
function SetState({ set }: { set: Listed & Partial<Pick<Schema<'RotationSet'>, 'readError'>> }) {
  return (
    <>
      {set.skipped.length > 0 && <p>Pas diffusé&nbsp;: {reasonsText(set.skipped)}.</p>}
      {set.readError && (
        <p className="admin-warning">
          {/* With U+FE0E, so that phones don't draw it as a colored emoji. */}
          {'\u26a0\ufe0e'} La piste n'a pas pu être lue sur SoundCloud&nbsp;: {set.readError}.
          {!set.skipped.includes('unread') && ' La radio continue avec ce qui en avait été lu avant.'}
        </p>
      )}
    </>
  )
}

// What a set's performers are called, e.g. "Aurore, Brume", or "Set" once they're all deleted.
const performerNames = (set: Listed) => set.performers.map((performer) => performer.name).join(', ') || 'Set'

// What finds a set in the field that adds one: its performers, its session's title, and its day, written out.
const searchFields = (set: Listed) => [...set.performers.map((performer) => performer.name), set.session.title, sessionLongDay(set.session)]

// Why saving the rotation `sent` failed: about one of its sets, by its place, or else the server's error.
function saveError(error: { error: string; setIndex?: number; reasons?: SkipReason[] }, sent: Listed[]): string {
  const set = error.setIndex === undefined ? undefined : sent[error.setIndex]
  if (!set) return `La rotation n'a pas pu être enregistrée\u00a0: ${error.error}`
  const named = `${capitalized(setInSentence(set))} (${sessionName(set.session)})`
  // Without `reasons`, it's the only error about a set that the page can get: it never sends a set twice.
  if (!error.reasons) return `${named} n'existe plus\u00a0: retirez-le de la rotation.`
  return `${named} ne peut pas être ajouté à la rotation\u00a0: ${reasonsText(error.reasons)}.`
}

type Step = 'editing' | 'confirming' | 'sending'

// The rotation's sets as they were shown when « modifier » was clicked, to reorder them, take them out, or add others,
// then save them once that's confirmed.
function EditRotation({ rotation, onCancel, onSaved }: { rotation: RadioRotation; onCancel: () => void; onSaved: (rotation: RadioRotation) => void }) {
  const [shown] = useState(() => shownOrder(rotation))
  const [sets, setSets] = useState<Listed[]>(shown)
  const [step, setStep] = useState<Step>('editing')
  const [error, setError] = useState<string | null>(null)
  // Loaded again once saving says that a set can't be added, which may no longer be the only one.
  const [candidatesVersion, setCandidatesVersion] = useState(0)
  const candidates = useApi('/api/admin/radio/rotation/candidates', { version: candidatesVersion })
  const pickerId = useId()
  const list = useRef<HTMLDivElement>(null)
  const save = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const locked = step !== 'editing'

  // The focus goes where « modifier » was, on the first set's handle, or on the field when there's none, then follows
  // the steps: on « confirmer » as it's asked, and back on « enregistrer » after it.
  useEffect(() => {
    ;(list.current?.querySelector<HTMLElement>('.admin-handle') ?? document.getElementById(pickerId))?.focus()
  }, [pickerId])
  const previousStep = useRef(step)
  useEffect(() => {
    if (step === 'confirming' && previousStep.current === 'editing') confirm.current?.focus()
    if (step === 'editing' && previousStep.current !== 'editing') save.current?.focus()
    previousStep.current = step
  }, [step])

  // The sets that can be added, then those taken out of the list, each once, unless they're in it.
  const offered = useMemo(() => {
    const listed = new Set(sets.map((set) => set.id))
    const removed = shown.filter((set) => !listed.has(set.id))
    const taken = new Set([...sets, ...shown].map((set) => set.id))
    const addable = candidates.kind === 'loaded' ? candidates.value.sets.filter((set) => !taken.has(set.id)) : []
    return [...addable.map((set): Listed => ({ ...set, skipped: [] })), ...removed]
  }, [candidates, sets, shown])
  // Kept from one render to the next, so that the field doesn't search them again on every render (see combobox.tsx).
  const options = useMemo(() => offered.map((set): ComboboxOption => ({ key: set.id, label: setName(set), detail: sessionName(set.session) })), [offered])
  const filter = useMemo((): ComboboxFilter => {
    const fields = new Map(offered.map((set) => [set.id, searchFields(set)]))
    return (options, query) => search(options, query, (option) => fields.get(option.key)!)
  }, [offered])

  const onAir = rotation.current?.setId
  const changed = sets.length !== shown.length || sets.some((set, i) => set.id !== shown[i].id)
  let consequence: string | null = null
  if (sets.length === 0) consequence = 'La rotation sera vide\u00a0: la radio sera hors ondes.'
  else if (onAir && !sets.some((set) => set.id === onAir)) consequence = 'Le set en cours en sera retiré\u00a0: la radio passera tout de suite au suivant.'

  const send = async () => {
    setStep('sending')
    const result = await api.PUT('/api/admin/radio/rotation', { body: { sets: sets.map((set) => set.id) } })
    if (result.ok) return onSaved(result)
    setStep('editing')
    setError(saveError(result, sets))
    if ('reasons' in result && result.reasons) setCandidatesVersion((version) => version + 1)
  }

  return (
    <>
      <div ref={list} className="rotation-edit">
        <OrderedList
          items={sets}
          keyOf={(set) => set.id}
          label={performerNames}
          name={(set) => setName(set, set.session)}
          detail={(set) => (
            <>
              {sessionName(set.session)}
              {set.id === onAir && <OnAirTag />}
              <SetState set={set} />
            </>
          )}
          onChange={setSets}
          nextFocus={pickerId}
          disabled={locked}
          autoScroll
        />
      </div>
      {sets.length === 0 && <p className="admin-placeholder">La rotation est vide.</p>}

      <div className="admin-form rotation-add">
        <div className="admin-field">
          <label htmlFor={pickerId}>Ajouter un set</label>
          <Combobox
            id={pickerId}
            options={options}
            selected={null}
            onSelect={(id) => {
              const set = offered.find((set) => set.id === id)
              if (set) setSets([...sets, set])
            }}
            filter={filter}
            placeholder={
              candidates.kind === 'error' ? "les sets n'ont pas pu être chargés" : candidates.kind === 'loading' ? 'chargement des sets…' : 'choisir un set…'
            }
            disabled={locked || candidates.kind === 'error'}
          />
        </div>
        <p className="admin-hint">
          On peut ajouter les sets qui ne sont pas annulés, qui ont une piste SoundCloud et une vidéo YouTube, et dont la
          session est annoncée, ainsi que ceux retirés de la liste.
        </p>
      </div>
      {candidates.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les sets qu'on peut ajouter n'ont pas pu être chargés&nbsp;: {candidates.message}
        </p>
      )}

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {step === 'editing' ? (
        <div className="admin-toolbar">
          <button
            ref={save}
            type="button"
            className="admin-primary"
            onClick={() => {
              setError(null)
              if (changed) setStep('confirming')
              else onCancel()
            }}
          >
            enregistrer
          </button>
          <button type="button" onClick={onCancel}>
            annuler
          </button>
        </div>
      ) : (
        <div className="admin-notice rotation-confirm">
          <p>Le changement s'applique tout de suite à la radio.</p>
          {consequence && <p>{consequence}</p>}
          <div className="admin-toolbar">
            <button ref={confirm} type="button" className="admin-primary" disabled={step === 'sending'} onClick={send}>
              {step === 'sending' ? 'enregistrement…' : 'confirmer'}
            </button>
            <button type="button" disabled={step === 'sending'} onClick={() => setStep('editing')}>
              revenir
            </button>
          </div>
        </div>
      )}
    </>
  )
}

