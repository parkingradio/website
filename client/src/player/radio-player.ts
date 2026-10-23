import type { RadioResponse, RadioStreamResponse } from 'shared/radio'
import { getJson } from '../api'
import { playStream, preloadHls, resumeStream } from './hls'
import { positionAt, untilEnd } from './radio'
import type { OnAir, RadioState } from './radio'
import { isSilent, loadVolume, saveVolume, toggledMute } from './volume'
import type { Volume } from './volume'

// While the radio is off air, it's asked for again this often, so that it comes back on its own.
const OFF_AIR_RETRY_MS = 60 * 1000
// What's on air next is asked for a little after the track on air ends, so that the server has moved along by then.
const NEXT_TRACK_DELAY_MS = 1000
// A stream's URL is only used while it has at least this long before it expires, since its playlist has to be loaded
// by then (see `RadioStreamResponse`).
const STREAM_MIN_REMAINING_MS = 60 * 1000
// How many times in a row a stream that stops working is asked for again, e.g. because its URL expired, before the
// player gives up and stops.
const MAX_STREAM_RETRIES = 2

type Stream = RadioStreamResponse & { ok: true }

export type PlayerState = {
  radio: RadioState
  // What's playing, or null when nothing is. It can differ from what's on air for a moment: a track that's playing goes
  // on until it ends, even if what's on air changed in the meantime (see shared/src/radio.ts).
  playing: OnAir | null
  // Whether what's playing is waiting for its sound to arrive.
  loading: boolean
  volume: Volume
}

/**
 * Plays the radio, "en ondes": what's on air, from where it's at, like every other listener (see `GET /api/radio`). It
 * knows nothing of React: PlayerProvider (player.tsx) shows its state, which it hands out through `subscribe` and
 * `getState`, and calls its methods.
 */
export class RadioPlayer {
  private state: PlayerState = { radio: { kind: 'loading' }, playing: null, loading: false, volume: loadVolume() }
  private readonly listeners = new Set<() => void>()

  // Goes up each time the visitor plays, pauses or stops the radio: what was under way for an earlier time is dropped,
  // so that e.g. pausing and playing again while the player waits for the server doesn't start two streams.
  private run = 0
  // Stops the stream that's playing, or paused, if any.
  private stopStream: (() => void) | null = null
  // The track that's paused, if any. Its stream stays loaded, so that the system can play it again, e.g. when AirPods
  // are put back in (see `play`).
  private paused: OnAir | null = null
  private retries = 0
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private connected = false

  // Stream URLs, by track id, and the requests for them under way. A stream is asked for as soon as its track is on
  // air, so that pressing play can start it right away, which some browsers require (see `playStream`).
  private readonly streams = new Map<string, Stream>()
  private readonly pendingStreams = new Map<string, Promise<Stream | null>>()

  private readonly audio: HTMLAudioElement
  // The system's media controls (e.g. media keys, AirPods, the lock screen), where the browser has them, and the track
  // they show.
  private readonly mediaSession = 'mediaSession' in navigator ? navigator.mediaSession : null
  private mediaSessionTrackId: string | null = null

  constructor(audio: HTMLAudioElement = new Audio()) {
    this.audio = audio
    audio.preload = 'none'
    audio.addEventListener('playing', () => {
      this.retries = 0
      this.update({ loading: false })
    })
    audio.addEventListener('waiting', () => this.update({ loading: true }))
    audio.addEventListener('ended', this.onEnded)
    // Something other than the player paused it, e.g. AirPods taken out. The player's own pauses and stops have nothing
    // playing, or no stream, by then, and a pause left over from a stream that was replaced arrives once the new one plays.
    audio.addEventListener('pause', () => {
      if (this.state.playing && this.stopStream && audio.paused && !audio.ended) this.pause()
    })
    // The system played it again itself, e.g. once a phone call ended. The player's own plays have nothing paused by then.
    audio.addEventListener('play', () => {
      if (this.paused && !audio.paused) this.play()
    })
    this.applyVolume()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): PlayerState => this.state

  /** Starts following what's on air. Returns a function that stops following it, and stops playing. */
  connect = (): (() => void) => {
    this.connected = true
    void this.loadRadio()
    preloadHls()
    document.addEventListener('visibilitychange', this.onVisible)
    this.mediaSession?.setActionHandler('play', this.play)
    this.mediaSession?.setActionHandler('pause', this.pause)
    return () => {
      this.connected = false
      clearTimeout(this.refreshTimer)
      document.removeEventListener('visibilitychange', this.onVisible)
      this.mediaSession?.setActionHandler('play', null)
      this.mediaSession?.setActionHandler('pause', null)
      this.stop()
    }
  }

  /** Plays the radio, where it's at, or pauses it. */
  toggleRadio = () => {
    if (this.state.playing) this.pause()
    else this.play()
  }

  /**
   * Pauses the radio, e.g. when something else on the page starts playing, and keeps its stream, so that the system can
   * play it again (see `paused`). While there's no stream yet, e.g. while it's asked for, it's stopped instead, and so is
   * a radio that's waiting for the server to say what to play.
   */
  pause = () => {
    if (!this.state.playing && !this.state.loading) return
    if (!this.state.playing || !this.stopStream) return this.stop()
    this.run += 1
    this.paused = this.state.playing
    this.update({ playing: null, loading: false })
    this.audio.pause()
  }

  setLevel = (level: number) => this.setVolume({ level, muted: false })

  toggleMute = () => this.setVolume(toggledMute(this.state.volume))

  private update(changes: Partial<PlayerState>) {
    const keys = Object.keys(changes) as (keyof PlayerState)[]
    if (!keys.every((key) => Object.is(changes[key], this.state[key]))) {
      this.state = { ...this.state, ...changes }
      for (const listener of this.listeners) listener()
    }
    // What's paused isn't part of the state, so this is done either way.
    this.showInMediaSession()
  }

  // Shows what plays, or is paused, in the system's media controls.
  private showInMediaSession() {
    const session = this.mediaSession
    if (!session) return
    const { playing } = this.state
    const track = (playing ?? this.paused)?.track ?? null
    if ((track?.id ?? null) !== this.mediaSessionTrackId) {
      this.mediaSessionTrackId = track?.id ?? null
      session.metadata = track ? new MediaMetadata({ title: track.artist, artist: 'parking.radio · en ondes' }) : null
    }
    session.playbackState = playing ? 'playing' : this.paused ? 'paused' : 'none'
  }

  private setVolume(volume: Volume) {
    this.update({ volume })
    this.applyVolume()
    saveVolume(volume)
  }

  private applyVolume() {
    this.audio.volume = this.state.volume.level
    this.audio.muted = isSilent(this.state.volume)
  }

  // Asks the server what's on air, and asks again when that track ends (or, off air, a while later). Resolves to what's
  // on air, or null when the radio is off air.
  private loadRadio = async (): Promise<OnAir | null> => {
    clearTimeout(this.refreshTimer)
    const result = await getJson<RadioResponse>('/api/radio?upcoming=0')
    if (!this.connected) return null
    // Another request may have been answered in the meantime: only the last one keeps a timer.
    clearTimeout(this.refreshTimer)
    if (!result.ok) {
      this.update({ radio: { kind: 'off-air' } })
      this.refreshTimer = setTimeout(this.loadRadio, OFF_AIR_RETRY_MS)
      return null
    }
    const onAir = result.current
    this.update({ radio: { kind: 'on-air', onAir } })
    void this.fetchStream(onAir.track.id)
    this.refreshTimer = setTimeout(this.loadRadio, untilEnd(onAir, Date.now()) + NEXT_TRACK_DELAY_MS)
    return onAir
  }

  // Timers can be held back in a tab that's in the background, so coming back to it catches up.
  private onVisible = () => {
    const { radio } = this.state
    if (document.visibilityState !== 'visible') return
    if (radio.kind !== 'on-air' || untilEnd(radio.onAir, Date.now()) === 0) void this.loadRadio()
  }

  private readyStream(trackId: string): Stream | null {
    const stream = this.streams.get(trackId)
    return stream && Date.parse(stream.expiresAt) - Date.now() > STREAM_MIN_REMAINING_MS ? stream : null
  }

  private fetchStream(trackId: string, fresh = false): Promise<Stream | null> {
    if (!fresh) {
      const ready = this.readyStream(trackId)
      if (ready) return Promise.resolve(ready)
      const pending = this.pendingStreams.get(trackId)
      if (pending) return pending
    }
    const request = getJson<RadioStreamResponse>(`/api/radio/tracks/${trackId}/stream`).then((result) => {
      // A fresh request may have been sent in the meantime: only the last one counts.
      if (this.pendingStreams.get(trackId) !== request) return result.ok ? result : null
      this.pendingStreams.delete(trackId)
      if (!result.ok) return null
      this.streams.set(trackId, result)
      return result
    })
    this.pendingStreams.set(trackId, request)
    return request
  }

  // Plays the radio, where it's at by then. The paused track picks up where the radio is at in it, if it's still on air.
  private play = () => {
    if (this.state.playing) return
    this.run += 1
    const { paused } = this
    this.paused = null
    const { radio } = this.state
    // What the page knows may be out of date, e.g. after the computer slept: the server is then asked again first.
    if (radio.kind === 'on-air' && untilEnd(radio.onAir, Date.now()) > 0) {
      const { onAir } = radio
      if (paused && this.stopStream && paused.track.id === onAir.track.id && paused.startedAt === onAir.startedAt) {
        return this.resume(paused)
      }
      this.stopPlaying()
      return this.playOnAir(onAir)
    }
    this.stopPlaying()
    // The paused track only counts as the one that ended if it did: the page may only think the radio is off air.
    this.playWhatsOnAir(paused && untilEnd(paused, Date.now()) === 0 ? paused : null)
  }

  // Plays the paused track again. It's the same object as when it was paused, as the checks on what plays (e.g. in
  // `recover`) expect. An element the system already played again only has to catch up with the radio.
  private resume(paused: OnAir) {
    this.update({ playing: paused, loading: this.audio.paused })
    resumeStream(this.audio, positionAt(paused, Date.now()), this.stop)
  }

  private stop = () => {
    this.run += 1
    this.retries = 0
    this.paused = null
    this.stopPlaying()
    this.update({ playing: null, loading: false })
  }

  private stopPlaying() {
    this.stopStream?.()
    this.stopStream = null
  }

  // Asks the server what's on air, then plays it. `ended` is the track that was playing, or paused, if any.
  private playWhatsOnAir = (ended: OnAir | null = this.state.playing) => {
    const run = this.run
    this.update({ loading: true })
    void this.loadRadio().then((onAir) => {
      if (run !== this.run) return
      if (!onAir) return this.stop()
      // The server may not have moved along yet, e.g. when the stream ended a little early: it's asked again once the
      // track that just ended is over.
      if (onAir.startedAt === ended?.startedAt && onAir.track.id === ended.track.id) {
        setTimeout(() => {
          if (run === this.run) this.playWhatsOnAir(ended)
        }, untilEnd(onAir, Date.now()) + NEXT_TRACK_DELAY_MS)
        return
      }
      this.playOnAir(onAir)
    })
  }

  // Plays `onAir`'s track, once its stream is known.
  private playOnAir(onAir: OnAir) {
    const ready = this.readyStream(onAir.track.id)
    if (ready) return this.playFrom(onAir, ready)
    this.update({ playing: onAir, loading: true })
    this.playWhenFetched(onAir, false)
  }

  // Plays `onAir`'s track once its stream has been asked for (again, if `fresh`), unless the radio was played or stopped,
  // or another track started playing, in the meantime.
  private playWhenFetched(onAir: OnAir, fresh: boolean) {
    const run = this.run
    void this.fetchStream(onAir.track.id, fresh).then((stream) => {
      if (run !== this.run || this.state.playing !== onAir) return
      if (stream) this.playFrom(onAir, stream)
      // A stream that was asked for again counts as another try.
      else if (fresh) this.recover(onAir)
      else this.stop()
    })
  }

  // Plays `onAir`'s track from `stream`, from where the radio is at in it by the time the stream has loaded.
  private playFrom(onAir: OnAir, stream: Stream) {
    this.stopPlaying()
    this.update({ playing: onAir, loading: true })
    this.stopStream = playStream(this.audio, stream.url, () => positionAt(onAir, Date.now()), {
      // The stream is dropped right away, so that it isn't paused, or played again, while it doesn't work.
      onError: () => {
        this.stopPlaying()
        this.recover(onAir)
      },
      onBlocked: this.stop,
    })
  }

  // A stream that stopped working is asked for again, and picks up where the radio is at by then.
  private recover(onAir: OnAir) {
    if (this.state.playing !== onAir) return
    if (this.retries >= MAX_STREAM_RETRIES) return this.stop()
    this.retries += 1
    this.playWhenFetched(onAir, true)
  }

  // A track that ends is followed by whatever is on air by then.
  private onEnded = () => {
    if (!this.state.playing) return
    this.stopPlaying()
    this.playWhatsOnAir()
  }
}
