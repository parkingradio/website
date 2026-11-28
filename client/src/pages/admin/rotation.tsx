import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { Schema } from '../../api/client'
import { useApi } from '../../api/use-api'
import { useTabShownCount } from '../../api/use-tab-shown'
import type { GenreId } from '../../artist-profile'
import { Combobox } from '../../combobox'
import type { ComboboxFilter, ComboboxOption } from '../../combobox'
import { QUEBEC_TIME_ZONE } from '../../quebec-time'
import { byWhom, capitalized, formatDuration, formatQuebecDayInYear, genreName, sessionLongDay, sessionName, setInSentence, setName } from './describe'
import { search } from './list'
import { OrderedList } from './ordered-list'
import { sessionPath } from './session-errors'
import { Performers } from './set-cells'

// The radio's rotation of sets, from its play head, and changing it (see docs/design/client/admin/rotation.md).

type RadioRotation = Schema<'RadioRotation'>
type SkipReason = Schema<'RotationSkipReason'>
// A set of the rotation, or one that can be added to it, with why it's skipped (never, for one that can be added, until
// its track is read).
type Listed = Schema<'RotationCandidate'> & Pick<Schema<'RotationSet'>, 'skipped'>
// A set that can be added, as it would be once added, with what was read of its track.
type WithTrack = Schema<'RotationCandidateWithTrack'>

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

// The rotation's sets, from its play head, as the server gives them, each one that isn't skipped with when it goes on
// air, and the day before it whenever it changes, as on the legacy page.
function RotationSets({ rotation }: { rotation: RadioRotation }) {
  if (rotation.sets.length === 0) return <p className="admin-placeholder">La rotation est vide&nbsp;: la radio est hors ondes.</p>
  const times = rotation.sets.map((set) => (set.startsAt === null ? null : Date.parse(set.startsAt)))
  const days = daysChanging(times, (time) => dayFormat.format(time))
  const { current } = rotation
  const onAir = current ? rotation.sets.findIndex((set) => set.id === current.setId) : -1
  return (
    <>
      {rotation.sets.every((set) => set.skipped.length > 0) && (
        <p className="admin-placeholder">Aucun set de la rotation ne peut être diffusé&nbsp;: la radio est hors ondes.</p>
      )}
      <PlayHead rows="[data-set]" index={onAir === -1 ? null : onAir}>
        <ol className="rotation-sets">
          {rotation.sets.map((set, i) => (
            <Fragment key={set.id}>
              {days[i] && <li className="rotation-day">{days[i]}</li>}
              <RotationSet set={set} startsAt={times[i]} onAir={i === onAir ? Date.parse(current!.startedAt) : null} />
            </Fragment>
          ))}
        </ol>
      </PlayHead>
    </>
  )
}

// The day of each of `times`, as `format` writes it, where it isn't that of the time before it that there is, and isn't the
// first, or else null, e.g. for a list's sets, which say the day whenever it changes.
function daysChanging(times: (number | null)[], format: (time: number) => string): (string | null)[] {
  let day: string | null = null
  return times.map((time) => {
    if (time === null) return null
    const previous = day
    day = format(time)
    return previous !== null && day !== previous ? day : null
  })
}

// A set's length, as the rows say it, e.g. "1 h 05", to the nearest minute.
const lengthText = (ms: number) => formatDuration(Math.round(ms / 60000))

// A set of the rotation, in columns: when it goes on air, or, for the set on air, when it went on air, `onAir`, in
// milliseconds since the epoch, then what it is, with its genres, then its length. The set on air shows how far into it
// the radio is, and says it's on air to screen readers, which the play head isn't drawn for.
function RotationSet({ set, startsAt, onAir }: { set: Schema<'RotationSet'>; startsAt: number | null; onAir: number | null }) {
  const skipped = set.skipped.length > 0
  return (
    <li data-set className={skipped ? 'rotation-set-skipped' : onAir !== null ? 'rotation-set-current' : undefined}>
      <span className="rotation-set-time">{startsAt === null ? '' : timeFormat.format(startsAt)}</span>
      <SetLines
        performers={
          <>
            {set.performers.length > 0 ? <Performers performers={set.performers} /> : 'Set'}
            {onAir !== null && <span className="visually-hidden"> en ondes</span>}
          </>
        }
        session={<Link to={sessionPath(set.session)}>{sessionName(set.session)}</Link>}
        genres={set.genres}
      >
        {onAir !== null && set.durationMs !== null && <Progress startedAt={onAir} durationMs={set.durationMs} />}
        <SetState set={set} />
      </SetLines>
      <span className="rotation-set-length">{set.durationMs !== null && lengthText(set.durationMs)}</span>
    </li>
  )
}

// What a set is, in lines, in the list as while it's changed: its performers, its session, then `children`, e.g. why it's
// skipped, with its genres beside them, or under its session on phones (see `.rotation-set` in admin.css).
function SetLines({ performers, session, genres, children }: { performers: ReactNode; session: ReactNode; genres: GenreId[]; children: ReactNode }) {
  return (
    <div className="rotation-set">
      <p className="rotation-set-performers">{performers}</p>
      <p className="rotation-set-session">{session}</p>
      <Genres genres={genres} />
      <div className="rotation-set-more">{children}</div>
    </div>
  )
}

// A set's genres, in order, as small labels, which screen readers read as text, e.g. "house, techno": the commas between
// them are only hidden from view. Without `rotation-genres-tags`, they're written out as text, as in the rest of the
// admin pages, rather than as labels. Nothing for a set without genres.
function Genres({ genres }: { genres: GenreId[] }) {
  if (genres.length === 0) return null
  return (
    <p className="rotation-genres rotation-genres-tags">
      {genres.map((genre, i) => (
        <Fragment key={genre}>
          {i > 0 && <span className="rotation-genres-sep">, </span>}
          <span className="rotation-genre">{genreName(genre)}</span>
        </Fragment>
      ))}
    </p>
  )
}

// The play head, drawn over the list `children` on its row `index`, among the rows that `rows` selects, or none when
// `index` is null: a line at the top of the row, with « ▶ en ondes » on it, and a tint over the row, as wide as it. It's the frame's
// rather than the row's, so that the rows move under it, e.g. while one is dragged. It's placed where the row is laid
// out, rather than where it's drawn, which moves while it's dragged, again on every render, and when the list's size
// changes, e.g. once the page's font is loaded, or, without ResizeObserver, when the window is resized.
function PlayHead({ rows, index, children }: { rows: string; index: number | null; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const tint = useRef<HTMLDivElement>(null)
  const place = useRef(() => {})
  useLayoutEffect(() => {
    place.current = () => {
      const row = index === null ? undefined : frame.current?.querySelectorAll<HTMLElement>(rows)[index]
      if (!head.current || !tint.current || !row) return
      head.current.style.top = `${row.offsetTop}px`
      head.current.style.height = `${row.offsetHeight}px`
      tint.current.style.left = `${row.offsetLeft}px`
      tint.current.style.width = `${row.offsetWidth}px`
    }
    place.current()
  })
  useEffect(() => {
    const placeAgain = () => place.current()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', placeAgain)
      return () => window.removeEventListener('resize', placeAgain)
    }
    const observer = new ResizeObserver(placeAgain)
    observer.observe(frame.current!)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={frame} className="rotation-frame">
      {children}
      {index !== null && (
        <div ref={head} className="rotation-head" aria-hidden="true">
          <div ref={tint} className="rotation-head-tint" />
          <span>▶ en ondes</span>
        </div>
      )}
    </div>
  )
}

// How long `ms` lasts, as a clock shows it, e.g. "23:14", or "1:02:05".
function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const [hours, minutes] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60]
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`
}

// The browser's clock, to the second, read once for what's being done, e.g. a render, until it's done, so that React
// gets the same snapshot each time it asks during a render, as it expects.
let reading: number | null = null
const toTheSecond = () => {
  if (reading === null) {
    reading = Math.floor(Date.now() / 1000) * 1000
    queueMicrotask(() => (reading = null))
  }
  return reading
}
const everySecond = (onTick: () => void) => {
  const timer = setInterval(() => {
    // Read again on each tick, even when several of them run in a row, e.g. with fake timers.
    reading = null
    onTick()
  }, 1000)
  return () => clearInterval(timer)
}
const never = () => () => {}

// The browser's clock, to the second, as of each time the component is drawn, which is every second while `ticking`, so
// that what depends on it moves on.
const useClock = (ticking: boolean): number => useSyncExternalStore(ticking ? everySecond : never, toTheSecond)

// How far into the set under the play head the radio is, out of `durationMs`: since `startedAt`, by the browser's clock,
// every second, or at its start without it. It keeps its own time, so that only it is drawn again every second.
function Progress({ startedAt, durationMs }: { startedAt: number | null; durationMs: number }) {
  const now = useClock(startedAt !== null)
  const elapsed = startedAt === null ? 0 : Math.min(Math.max(now - startedAt, 0), durationMs)
  return (
    <div className="rotation-progress">
      <div
        role="progressbar"
        aria-label="Avancement du set"
        aria-valuemin={0}
        aria-valuemax={Math.floor(durationMs / 1000)}
        aria-valuenow={Math.floor(elapsed / 1000)}
        aria-valuetext={`${formatDuration(Math.floor(elapsed / 60000))} sur ${lengthText(durationMs)}`}
        className="rotation-progress-bar"
      >
        <div style={{ width: `${(elapsed / durationMs) * 100}%` }} />
      </div>
      <span className="rotation-progress-time" aria-hidden="true">
        {clock(elapsed)} / {clock(durationMs)}
      </span>
    </div>
  )
}

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

// How long a set lasts, in milliseconds, once its track has been read, which a set that can be added hasn't been until
// what reading it answered is known.
const lengthOf = (set: Listed): number | null => ('durationMs' in set && typeof set.durationMs === 'number' ? set.durationMs : null)

// What a set's performers are called, e.g. "Aurore, Brume", or "Set" once they're all deleted.
const performerNames = (set: Listed) => set.performers.map((performer) => performer.name).join(', ') || 'Set'

// What finds a set in the field that adds one: its performers, its session's title, its day, written out, and its genres,
// as the admin pages name them.
const searchFields = (set: Listed) => [
  ...set.performers.map((performer) => performer.name),
  set.session.title,
  sessionLongDay(set.session),
  ...set.genres.map(genreName),
]

// What the field that adds a set says of it after its name: its session, and its genres, if it has any, e.g.
// "GUEST MIXES, ven. 16 oct. 2026 · ambient, techno".
const optionDetail = (set: Listed) => [sessionName(set.session), set.genres.map(genreName).join(', ')].filter(Boolean).join(' · ')

// Why saving the rotation `sent` failed: about one of its sets, by its place, or else the server's error.
function saveError(error: { error: string; setIndex?: number; reasons?: SkipReason[] }, sent: Listed[]): string {
  const set = error.setIndex === undefined ? undefined : sent[error.setIndex]
  if (!set) return `La rotation n'a pas pu être enregistrée\u00a0: ${error.error}`
  const named = `${capitalized(setInSentence(set))} (${sessionName(set.session)})`
  // Without `reasons`, it's the only error about a set that the page can get: it never sends a set twice.
  if (!error.reasons) return `${named} n'existe plus\u00a0: retirez-le de la rotation.`
  return `${named} ne peut pas être ajouté à la rotation\u00a0: ${reasonsText(error.reasons)}.`
}

// When each of `sets` would go on air once they're saved, or null when it's skipped, or that isn't known: the first that
// can be played, which is under the play head, at `start`, then each one after it that can be played as the one before it
// ends, up to the first whose length isn't known (see "Changing the rotation" in docs/design/client/admin/rotation.md).
function startTimes(sets: Listed[], start: number): (number | null)[] {
  let next: number | null = start
  return sets.map((set) => {
    if (set.skipped.length > 0 || next === null) return null
    const startsAt = next
    const length = lengthOf(set)
    next = length === null ? null : startsAt + length
    return startsAt
  })
}

type Step = 'editing' | 'confirming' | 'sending'

// The rotation's sets as they were shown when « modifier » was clicked, to reorder them, take them out, or add others,
// then save them once that's confirmed.
function EditRotation({ rotation, onCancel, onSaved }: { rotation: RadioRotation; onCancel: () => void; onSaved: (rotation: RadioRotation) => void }) {
  const [shown] = useState(rotation.sets)
  const [sets, setSets] = useState<Listed[]>(shown)
  const [step, setStep] = useState<Step>('editing')
  const [error, setError] = useState<string | null>(null)
  // What reading their tracks last answered for the sets added that weren't in the rotation, by id, which their rows show
  // in their place, wherever they're moved, even once they're taken out and added again.
  const [answers, setAnswers] = useState<ReadonlyMap<string, WithTrack>>(new Map())
  // The last request for each of them, so that an answer to an earlier one doesn't replace that of a later one.
  const asked = useRef(new Map<string, number>())
  // Loaded again once saving says that a set can't be added, which may no longer be the only one.
  const [candidatesVersion, setCandidatesVersion] = useState(0)
  const candidates = useApi('/api/admin/radio/rotation/candidates', { version: candidatesVersion })
  const pickerId = useId()
  // What the confirmation is described by, for screen readers, which read it as the focus moves into it.
  const confirmationId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const save = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const locked = step !== 'editing'

  // The focus goes where « modifier » was, on the first set's handle, or on the field when there's none. The confirmation
  // is a modal dialog, which the browser draws over the page, closes with Escape, and keeps the focus in while it's open:
  // it opens with the focus on « confirmer », and closes with it back on « enregistrer ».
  useEffect(() => {
    ;(list.current?.querySelector<HTMLElement>('.admin-handle') ?? document.getElementById(pickerId))?.focus()
  }, [pickerId])
  const previousStep = useRef(step)
  useEffect(() => {
    if (step === 'confirming' && previousStep.current === 'editing') {
      dialog.current?.showModal()
      confirm.current?.focus()
    }
    if (step === 'editing' && previousStep.current !== 'editing') {
      dialog.current?.close()
      save.current?.focus()
    }
    previousStep.current = step
  }, [step])

  // The sets that can be added, then those taken out of the list, each once, unless they're in it.
  const offered = useMemo(() => {
    const ids = new Set(sets.map((set) => set.id))
    const removed = shown.filter((set) => !ids.has(set.id))
    const taken = new Set([...sets, ...shown].map((set) => set.id))
    const addable = candidates.kind === 'loaded' ? candidates.value.sets.filter((set) => !taken.has(set.id)) : []
    return [...addable.map((set): Listed => ({ ...set, skipped: [] })), ...removed]
  }, [candidates, sets, shown])
  // Kept from one render to the next, so that the field doesn't search them again on every render (see combobox.tsx).
  const options = useMemo(() => offered.map((set): ComboboxOption => ({ key: set.id, label: setName(set), detail: optionDetail(set) })), [offered])
  const filter = useMemo((): ComboboxFilter => {
    const fields = new Map(offered.map((set) => [set.id, searchFields(set)]))
    return (options, query) => search(options, query, (option) => fields.get(option.key)!)
  }, [offered])

  // Reads the track of `id`, a set that wasn't in the rotation, as it's added (see "Changing the rotation" in
  // docs/design/client/admin/rotation.md). Without an answer, the set stays as it was offered.
  const readTrack = (id: string) => {
    const request = (asked.current.get(id) ?? 0) + 1
    asked.current.set(id, request)
    api.GET('/api/admin/radio/rotation/candidates/{id}', { params: { path: { id } } }).then((result) => {
      if (result.ok && asked.current.get(id) === request) setAnswers((answers) => new Map(answers).set(id, result.set))
    })
  }
  // The same from one render to the next, e.g. while the clock ticks, unless they change.
  const listed = useMemo(() => sets.map((set) => answers.get(set.id) ?? set), [sets, answers])

  // The set on air, as the rotation was last loaded, and the one that will be once it's saved: the first that can be
  // played, the sets added whose tracks haven't been read yet counting as ones that can be, since saving reads them (see
  // "On air" in docs/design/server/radio.md). An answer that comes while saving is confirmed changes what it says it does.
  const onAir = rotation.current && rotation.sets.find((set) => set.id === rotation.current!.setId)
  const head = listed.find((set) => set.skipped.length === 0)
  // When each set would go on air: the set under the play head goes on, if it's the set on air, or else starts now, by
  // the browser's clock.
  const headStartedAt = head !== undefined && head.id === onAir?.id ? Date.parse(rotation.current!.startedAt) : null
  const now = useClock(head !== undefined && headStartedAt === null)
  const times = startTimes(listed, headStartedAt ?? now)
  const days = daysChanging(times, formatQuebecDayInYear)
  const changed = sets.length !== shown.length || sets.some((set, i) => set.id !== shown[i].id)
  // What saving does to what's on air.
  let consequence: string
  if (sets.length === 0) consequence = 'La rotation sera vide\u00a0: la radio sera hors ondes.'
  else if (!head) consequence = 'Aucun set de la rotation ne pourra être diffusé\u00a0: la radio sera hors ondes.'
  else if (!onAir) consequence = `La radio reviendra tout de suite en ondes, avec ${setInSentence(head)}.`
  else if (head.id === onAir.id) consequence = "Le set en cours continue\u00a0: les changements s'appliquent dès le set suivant."
  else consequence = `${capitalized(setInSentence(head))} passera tout de suite en ondes, à la place ${setInSentence(onAir, 'du')}.`

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
        <PlayHead rows="[data-item]" index={head ? listed.indexOf(head) : null}>
          <OrderedList
            items={listed}
            keyOf={(set) => set.id}
            label={performerNames}
            name={(set) => setName(set, set.session)}
            lead={(_, i) => (
              <span className="rotation-set-time">
                {days[i] && <span className="rotation-edit-day">{days[i]}</span>}
                {times[i] !== null && timeFormat.format(times[i])}
              </span>
            )}
            text={(set) => {
              const length = lengthOf(set)
              return (
                <SetLines
                  performers={performerNames(set)}
                  session={
                    <>
                      {set === head && <span className="visually-hidden">en ondes </span>}
                      {sessionName(set.session)}
                      {length !== null && ` · ${lengthText(length)}`}
                    </>
                  }
                  genres={set.genres}
                >
                  {/* The set on air goes on, and another starts from its start, if its length is known. */}
                  {set === head && length !== null && <Progress startedAt={headStartedAt} durationMs={length} />}
                  <SetState set={set} />
                </SetLines>
              )
            }}
            onChange={setSets}
            nextFocus={pickerId}
            disabled={locked}
            autoScroll
          />
        </PlayHead>
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
              if (!set) return
              setSets([...sets, set])
              if (!shown.some((other) => other.id === id)) readTrack(id)
            }}
            filter={filter}
            placeholder={
              candidates.kind === 'error' ? "les sets n'ont pas pu être chargés" : candidates.kind === 'loading' ? 'chargement des sets…' : 'choisir un set…'
            }
            disabled={locked || candidates.kind === 'error'}
          />
        </div>
        <p className="admin-hint">Seuls les sets annoncés et joués, avec un lien SoundCloud et YouTube, sont disponibles.</p>
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
      <dialog
        ref={dialog}
        className="rotation-confirm"
        aria-label="Enregistrer la rotation"
        aria-describedby={confirmationId}
        // Escape goes back to changing the list, but not while the rotation is sent. Browsers can close it anyway, e.g. on
        // a second Escape, which goes back to changing the list too.
        onCancel={(event) => {
          event.preventDefault()
          if (step === 'confirming') setStep('editing')
        }}
        onClose={() => {
          if (step === 'confirming') setStep('editing')
        }}
      >
        <p id={confirmationId}>{consequence}</p>
        <div className="admin-toolbar">
          <button ref={confirm} type="button" className="admin-primary" disabled={step === 'sending'} onClick={send}>
            {step === 'sending' ? 'enregistrement…' : 'confirmer'}
          </button>
          <button type="button" disabled={step === 'sending'} onClick={() => setStep('editing')}>
            revenir
          </button>
        </div>
      </dialog>
    </>
  )
}

