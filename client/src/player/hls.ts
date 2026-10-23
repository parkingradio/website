// Tracks are streamed as HLS playlists on SoundCloud's CDN (see `GET /api/radio/tracks/:id/stream`). Safari, and recent
// versions of Chrome, play HLS themselves. Other browsers, like Firefox, go through hls.js, which is only loaded for them.

// The light build is enough: it leaves out subtitles, alternate audio tracks and DRM, which the streams don't use.
type HlsModule = typeof import('hls.js/light')

let hlsModule: Promise<HlsModule> | null = null

/** Whether this browser plays HLS itself. */
export function playsHlsNatively(): boolean {
  return document.createElement('audio').canPlayType('application/vnd.apple.mpegurl') !== ''
}

/** Loads hls.js ahead of time, when this browser needs it, so that pressing play doesn't wait for it. */
export function preloadHls() {
  if (!playsHlsNatively()) loadHls().catch(() => {})
}

function loadHls(): Promise<HlsModule> {
  hlsModule ??= import('hls.js/light').catch((error: unknown) => {
    hlsModule = null
    throw error
  })
  return hlsModule
}

type Callbacks = {
  // The stream can't be played anymore, e.g. because its URL expired: a new one has to be asked for. It's reported by
  // the audio element where the browser plays HLS itself, and by hls.js otherwise.
  onError: () => void
  // The browser refused to start playing, e.g. because it wasn't in answer to a click.
  onBlocked: () => void
}

/**
 * Plays the HLS playlist at `url` in `audio`, from `position()` seconds into it. `position` is only called once the
 * playlist has loaded, so that the time that took doesn't put the radio behind. Returns a function that stops it.
 *
 * Where the browser plays HLS itself, playing starts right away, so that a browser that only lets a page play sound in
 * answer to a click (like Safari) still counts it as one.
 */
export function playStream(audio: HTMLAudioElement, url: string, position: () => number, callbacks: Callbacks): () => void {
  if (playsHlsNatively()) {
    const seek = () => {
      audio.currentTime = position()
    }
    audio.addEventListener('loadedmetadata', seek, { once: true })
    audio.addEventListener('error', callbacks.onError)
    audio.src = url
    play(audio, callbacks.onBlocked)
    return () => {
      audio.removeEventListener('loadedmetadata', seek)
      audio.removeEventListener('error', callbacks.onError)
      stopAudio(audio)
    }
  }

  let stopped = false
  let hls: InstanceType<HlsModule['default']> | null = null
  loadHls()
    .then(({ default: Hls }) => {
      if (stopped) return
      hls = new Hls({ startPosition: position() })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) callbacks.onError()
      })
      hls.loadSource(url)
      hls.attachMedia(audio)
      play(audio, callbacks.onBlocked)
    })
    .catch(() => {
      if (!stopped) callbacks.onError()
    })
  return () => {
    stopped = true
    hls?.destroy()
    stopAudio(audio)
  }
}

/** Plays `audio` again after it was paused while playing a stream, from `position` seconds into the stream. */
export function resumeStream(audio: HTMLAudioElement, position: number, onBlocked: () => void) {
  audio.currentTime = position
  play(audio, onBlocked)
}

function play(audio: HTMLAudioElement, onBlocked: () => void) {
  audio.play().catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'NotAllowedError') onBlocked()
  })
}

function stopAudio(audio: HTMLAudioElement) {
  audio.pause()
  audio.removeAttribute('src')
  // Drops what the element had loaded, so that it doesn't keep downloading the stream.
  audio.load()
}
