import { useEffect, useRef } from 'react'
import './legacy-radio.css'

// The radio bar of the home page's old "combined widget" (combined_widget.html, which was hosted on R2), while the new
// player's feature flag (`nouveau-lecteur`) is off. It's meant to be deleted along with that flag, so it's a port that
// stays as close to the original as it can, rather than a React component of our own: React renders its markup once,
// and `mountLegacyRadio` runs the original's script on it, which owns it from then on. Nothing here re-renders.
//
// It plays a rotation of its own, which it reads from playlist.json and durations.json on R2, kept up to date outside
// this repo, and computes what's on air from the time alone, so that every listener hears the same thing. It pauses the
// YouTube widget when it plays, and the other way around, through a BroadcastChannel (see youtube.tsx).

const PLAYLIST_URL = 'https://pub-ac6abcc67fed4f8f8072bac54bb99274.r2.dev/playlist.json'
const DURATIONS_URL = 'https://pub-ac6abcc67fed4f8f8072bac54bb99274.r2.dev/durations.json'

// Shared with youtube.tsx: each one says when it starts playing, and pauses when the other one does.
const CHANNEL = 'parking_radio'
const PLAYING = 'audio_playing'
const OTHER_PLAYING = 'yt_playing'

export function LegacyRadio() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => mountLegacyRadio(root.current!), [])

  return (
    <div ref={root} className="legacy-radio">
      <div className="legacy-radio-bar">
        <button className="legacy-radio-play" aria-label="Play">
          <svg className="legacy-radio-icon-play" width="10" height="12" viewBox="0 0 10 12" fill="none">
            <path d="M1 1l8 5-8 5V1z" fill="#000" />
          </svg>
          <svg
            className="legacy-radio-icon-pause"
            width="10"
            height="12"
            viewBox="0 0 10 12"
            fill="none"
            style={{ display: 'none' }}
          >
            <rect x="1" y="1" width="3" height="10" fill="#000" />
            <rect x="6" y="1" width="3" height="10" fill="#000" />
          </svg>
        </button>

        <div className="legacy-radio-live-dot"></div>
        <span className="legacy-radio-on-air">On Air</span>
        <div className="legacy-radio-progress">
          <div className="legacy-radio-progress-bar"></div>
        </div>
        <div className="legacy-radio-track"></div>
        <span className="legacy-radio-status">loading…</span>
        <button className="legacy-radio-schedule-button">Schedule ▾</button>
        <button className="legacy-radio-live-button">● Live</button>

        <div className="legacy-radio-volume">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 4.5h2.5L7 1.5v11L3.5 9.5H1V4.5z" fill="#000" />
            <path d="M9 3.5c1.5 1 2.5 2.5 2.5 4s-1 3-2.5 4" stroke="#000" strokeWidth="1" strokeLinecap="round" />
          </svg>
          <input type="range" aria-label="Volume" min="0" max="1" step="0.01" defaultValue="0.8" />
        </div>
      </div>

      {/* Over the marquee, and what comes after it. */}
      <div className="legacy-radio-schedule">
        <table>
          <thead>
            <tr>
              <th className="legacy-radio-time">Start ET</th>
              <th className="legacy-radio-name">Artist</th>
              <th className="legacy-radio-date">Date</th>
              <th className="legacy-radio-duration">Duration</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <div className="legacy-radio-marquee">
        <div className="legacy-radio-marquee-track"></div>
      </div>

      <audio preload="none"></audio>
    </div>
  )
}

type Track = { url: string; name: string; date: string }

/** Runs the original widget's script on `root`, the markup LegacyRadio renders, and returns what stops it. */
function mountLegacyRadio(root: HTMLElement): () => void {
  const $ = <E extends Element = HTMLElement>(selector: string) => root.querySelector<E>(selector)!

  const audio = $<HTMLAudioElement>('audio')
  const playBtn = $<HTMLButtonElement>('.legacy-radio-play')
  const iconPlay = $<SVGElement>('.legacy-radio-icon-play')
  const iconPause = $<SVGElement>('.legacy-radio-icon-pause')
  const liveDot = $('.legacy-radio-live-dot')
  const progressWrap = $('.legacy-radio-progress')
  const progressBar = $('.legacy-radio-progress-bar')
  const trackInfoEl = $('.legacy-radio-track')
  const statusEl = $('.legacy-radio-status')
  const volumeEl = $<HTMLInputElement>('.legacy-radio-volume input')
  const schedBtn = $('.legacy-radio-schedule-button')
  const liveBtn = $('.legacy-radio-live-button')
  const schedPanel = $('.legacy-radio-schedule')
  const schedBody = $('.legacy-radio-schedule tbody')
  const marqueeTrack = $('.legacy-radio-marquee-track')
  const onAirEl = $('.legacy-radio-on-air')

  // Everything the script listens to stops when it's aborted, and so do the requests under way.
  const stopped = new AbortController()
  const { signal } = stopped

  let tracks: Track[] = [],
    durations: number[] = [],
    playing = false,
    currentIndex = -1,
    ready = false
  let ticker: ReturnType<typeof setInterval> | undefined
  let mode: 'live' | 'selected' = 'live'

  // ── Coordination with the YouTube widget ──
  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.addEventListener('message', (e) => {
      if (e.data === OTHER_PLAYING && playing) pauseRadio()
    })
  } catch {
    // Without BroadcastChannel, the radio and the video just don't pause each other.
  }

  function notifyPlaying() {
    channel?.postMessage(PLAYING)
  }

  function pauseRadio() {
    playing = false
    audio.pause()
    clearInterval(ticker)
    iconPlay.style.display = 'block'
    iconPause.style.display = 'none'
    liveDot.classList.remove('legacy-radio-live')
    trackInfoEl.replaceChildren()
    currentIndex = -1
    mode = 'live'
    onAirEl.textContent = 'On Air'
    liveBtn.style.display = 'none'
    progressWrap.classList.remove('legacy-radio-seekable')
  }

  // ── Time ──
  function pad(n: number) {
    return String(n).padStart(2, '0')
  }
  // Eastern time's offset from UTC: daylight time from the second Sunday of March to the first Sunday of November,
  // switching at midnight UTC rather than at 2 AM local time.
  function etOffset() {
    const now = new Date(),
      y = now.getUTCFullYear()
    function nthSun(mo: number, n: number) {
      const d = new Date(Date.UTC(y, mo, 1))
      d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7) + (n - 1) * 7)
      return d
    }
    return now >= nthSun(2, 2) && now < nthSun(10, 1) ? -4 : -5
  }
  function fmtShort(ms: number) {
    const d = new Date(ms + etOffset() * 3600000)
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes())
  }
  function fmtDur(s: number) {
    s = Math.round(s)
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60)
    return h > 0 ? h + 'h ' + pad(m) + 'm' : m + 'm'
  }

  // ── Init ──
  async function init() {
    const [data, cached] = await Promise.all([
      fetch(PLAYLIST_URL + '?v=' + Date.now(), { signal }).then((r) => r.json()),
      fetch(DURATIONS_URL + '?v=' + Date.now(), { signal })
        .then((r) => r.json())
        .catch(() => null),
    ])
    if (signal.aborted) return
    tracks = data
    durations = cached && cached.length === tracks.length ? cached : tracks.map(() => 3600)
    statusEl.textContent = ''
    ready = true
    buildMarquee()
    renderSchedule()
  }

  function totalDur() {
    return durations.reduce((a, b) => a + b, 0)
  }

  function getSchedule() {
    const pos = (Date.now() / 1000) % totalDur()
    let acc = 0
    for (let i = 0; i < tracks.length; i++) {
      if (pos < acc + durations[i]) return { index: i, offset: pos - acc }
      acc += durations[i]
    }
    return { index: 0, offset: 0 }
  }

  // ── Marquee (JS-driven for Safari compatibility) ──
  let marqueeX = 0
  let marqueeHalfWidth = 0
  let marqueeRunning = false
  let marqueeFrame = 0

  function buildMarquee() {
    const names = tracks.map((t) => t.name).join('   ·   ')
    const text = names + '   ·   '
    // Double it for seamless loop
    marqueeTrack.textContent = text + text

    // Measure half width after render
    marqueeFrame = requestAnimationFrame(function () {
      marqueeHalfWidth = marqueeTrack.scrollWidth / 2
      marqueeX = 0
      if (!marqueeRunning) {
        marqueeRunning = true
        animateMarquee()
      }
    })
  }

  function animateMarquee() {
    marqueeX -= 0.5 // px per frame ~30px/s at 60fps
    if (marqueeHalfWidth > 0 && Math.abs(marqueeX) >= marqueeHalfWidth) {
      marqueeX = 0
    }
    marqueeTrack.style.left = marqueeX + 'px'
    marqueeFrame = requestAnimationFrame(animateMarquee)
  }

  // ── Schedule ──
  // The schedule's rows, by the index of their track.
  const rowsByIndex = new Map<number, HTMLTableRowElement>()

  function cell(className: string, text: string) {
    const td = document.createElement('td')
    td.className = className
    td.textContent = text
    return td
  }

  function badge(onDemand: boolean) {
    const span = document.createElement('span')
    span.className = onDemand ? 'legacy-radio-badge legacy-radio-badge-demand' : 'legacy-radio-badge'
    span.textContent = onDemand ? 'on demand' : 'on air'
    return span
  }

  function buildRows() {
    const total = totalDur(),
      posNow = (Date.now() / 1000) % total
    const cycleStartMs = Date.now() - posNow * 1000
    let acc = 0
    return tracks.map(function (t, i) {
      const startMs = cycleStartMs + acc * 1000
      const isOnAir = acc <= posNow && posNow < acc + durations[i]
      acc += durations[i]
      return { name: t.name, date: t.date, startMs, dur: durations[i], isOnAir, index: i }
    })
  }

  function renderSchedule() {
    schedBody.replaceChildren()
    rowsByIndex.clear()
    const rows = buildRows()
    const onAirIdx = rows.findIndex((r) => r.isOnAir)
    // Rotate so on-air track is first, rest follow in order
    const sorted = onAirIdx >= 0 ? rows.slice(onAirIdx).concat(rows.slice(0, onAirIdx)) : rows
    sorted.forEach(function (row) {
      const tr = document.createElement('tr')
      rowsByIndex.set(row.index, tr)
      if (row.isOnAir) tr.classList.add('legacy-radio-row-on-air')
      const isSelected = mode === 'selected' && row.index === currentIndex && !row.isOnAir
      if (isSelected) tr.classList.add('legacy-radio-row-selected')
      const name = cell('legacy-radio-name', row.name)
      if (row.isOnAir || isSelected) name.append(badge(!row.isOnAir))
      tr.append(
        cell('legacy-radio-time', fmtShort(row.startMs)),
        name,
        cell('legacy-radio-date', row.date),
        cell('legacy-radio-duration', fmtDur(row.dur)),
      )
      tr.addEventListener('click', () => selectTrack(row.index), { signal })
      schedBody.appendChild(tr)
    })
  }

  function updateSchedule() {
    buildRows().forEach(function (row) {
      const tr = rowsByIndex.get(row.index)
      if (!tr) return
      const existing = tr.querySelector('.legacy-radio-badge')
      const name = tr.querySelector('.legacy-radio-name')!
      const isSelected = mode === 'selected' && row.index === currentIndex && !row.isOnAir
      if (row.isOnAir) {
        tr.classList.add('legacy-radio-row-on-air')
        tr.classList.remove('legacy-radio-row-selected')
        if (!existing || !existing.textContent!.includes('on air')) {
          existing?.remove()
          name.append(badge(false))
        }
      } else {
        tr.classList.remove('legacy-radio-row-on-air')
        if (isSelected) {
          tr.classList.add('legacy-radio-row-selected')
          if (!existing || !existing.classList.contains('legacy-radio-badge-demand')) {
            existing?.remove()
            name.append(badge(true))
          }
        } else {
          tr.classList.remove('legacy-radio-row-selected')
          existing?.remove()
        }
      }
      tr.querySelector('.legacy-radio-time')!.textContent = fmtShort(row.startMs)
    })
  }

  schedBtn.addEventListener(
    'click',
    function () {
      const open = schedPanel.classList.toggle('legacy-radio-open')
      schedBtn.textContent = open ? 'Schedule ▴' : 'Schedule ▾'
      if (open) schedPanel.scrollTop = 0
    },
    { signal },
  )

  // ── Playback ──
  function showInfo(index: number) {
    const t = tracks[index]
    if (!t) return
    const rediff = document.createElement('span')
    rediff.className = 'legacy-radio-rediff'
    rediff.textContent = '[rediffusion]'
    trackInfoEl.replaceChildren(t.name + ' \u00a0' + t.date + '\u00a0', rediff)
  }

  function startTrack(index: number, offset: number) {
    currentIndex = index
    audio.src = tracks[index].url
    audio.volume = parseFloat(volumeEl.value)
    audio.load()
    showInfo(index)
    // Like the original, nothing is shown when the browser refuses to play.
    audio.onloadedmetadata = function () {
      audio.currentTime = Math.min(offset, audio.duration - 1)
      audio.play().catch(() => {})
    }
  }

  function tick() {
    if (!playing || mode !== 'live') return
    const { index, offset } = getSchedule()
    if (index !== currentIndex) {
      startTrack(index, offset)
      return
    }
    if (audio.readyState >= 2 && isFinite(audio.duration)) {
      if (Math.abs(audio.currentTime - offset) > 5) audio.currentTime = Math.min(offset, audio.duration - 1)
    }
    const pos = (Date.now() / 1000) % totalDur()
    progressBar.style.width = (pos / totalDur()) * 100 + '%'
    showInfo(currentIndex)
    if (schedPanel.classList.contains('legacy-radio-open')) updateSchedule()
  }

  function tickSelected() {
    if (!playing || mode !== 'selected') return
    if (audio.readyState >= 2 && isFinite(audio.duration) && audio.duration > 0) {
      progressBar.style.width = (audio.currentTime / audio.duration) * 100 + '%'
    }
    if (schedPanel.classList.contains('legacy-radio-open')) updateSchedule()
  }

  function startLive() {
    clearInterval(ticker)
    mode = 'live'
    onAirEl.textContent = 'On Air'
    liveBtn.style.display = 'none'
    progressWrap.classList.remove('legacy-radio-seekable')
    playing = true
    iconPlay.style.display = 'none'
    iconPause.style.display = 'block'
    liveDot.classList.add('legacy-radio-live')
    const { index, offset } = getSchedule()
    startTrack(index, offset)
    notifyPlaying()
    ticker = setInterval(tick, 1000)
    if (schedPanel.classList.contains('legacy-radio-open')) updateSchedule()
  }

  function selectTrack(index: number) {
    if (!ready || !tracks[index]) return
    clearInterval(ticker)
    mode = 'selected'
    currentIndex = index
    audio.src = tracks[index].url
    audio.volume = parseFloat(volumeEl.value)
    audio.load()
    showInfo(index)
    audio.onloadedmetadata = function () {
      audio.currentTime = 0
      audio.play().catch(() => {})
    }
    playing = true
    iconPlay.style.display = 'none'
    iconPause.style.display = 'block'
    liveDot.classList.remove('legacy-radio-live')
    onAirEl.textContent = 'On Demand'
    liveBtn.style.display = 'inline-block'
    progressBar.style.width = '0%'
    progressWrap.classList.add('legacy-radio-seekable')
    notifyPlaying()
    ticker = setInterval(tickSelected, 500)
    updateSchedule()
  }

  audio.addEventListener(
    'ended',
    function () {
      if (mode === 'selected') startLive()
    },
    { signal },
  )

  liveBtn.addEventListener(
    'click',
    function () {
      if (!ready) return
      startLive()
    },
    { signal },
  )

  playBtn.addEventListener(
    'click',
    function () {
      if (!ready) return
      if (!playing) {
        if (currentIndex === -1) {
          startLive()
        } else if (mode === 'live') {
          iconPlay.style.display = 'none'
          iconPause.style.display = 'block'
          liveDot.classList.add('legacy-radio-live')
          playing = true
          const { index, offset } = getSchedule()
          startTrack(index, offset)
          ticker = setInterval(tick, 1000)
        } else {
          iconPlay.style.display = 'none'
          iconPause.style.display = 'block'
          playing = true
          audio.play().catch(() => {})
          ticker = setInterval(tickSelected, 500)
        }
        notifyPlaying()
      } else {
        playing = false
        audio.pause()
        clearInterval(ticker)
        iconPlay.style.display = 'block'
        iconPause.style.display = 'none'
        liveDot.classList.remove('legacy-radio-live')
      }
    },
    { signal },
  )

  volumeEl.addEventListener(
    'input',
    function () {
      audio.volume = parseFloat(volumeEl.value)
    },
    { signal },
  )

  // ── Seek (On Demand only) ──
  let seeking = false

  function seekFromEvent(e: PointerEvent) {
    if (mode !== 'selected' || !audio.duration || !isFinite(audio.duration)) return
    const rect = progressWrap.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = Math.min(1, Math.max(0, x / rect.width))
    audio.currentTime = ratio * audio.duration
    progressBar.style.width = ratio * 100 + '%'
  }

  progressWrap.addEventListener(
    'pointerdown',
    function (e) {
      if (mode !== 'selected') return
      seeking = true
      progressWrap.setPointerCapture(e.pointerId)
      seekFromEvent(e)
    },
    { signal },
  )
  progressWrap.addEventListener(
    'pointermove',
    function (e) {
      if (!seeking) return
      seekFromEvent(e)
    },
    { signal },
  )
  progressWrap.addEventListener(
    'pointerup',
    function (e) {
      if (!seeking) return
      seeking = false
      seekFromEvent(e)
    },
    { signal },
  )
  progressWrap.addEventListener(
    'pointercancel',
    function () {
      seeking = false
    },
    { signal },
  )

  // When the rotation can't be read, the bar stays "loading…", as it did in the original.
  init().catch(() => {})

  return () => {
    stopped.abort()
    channel?.close()
    clearInterval(ticker)
    cancelAnimationFrame(marqueeFrame)
    audio.onloadedmetadata = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
}
