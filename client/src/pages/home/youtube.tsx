import { useCallback, useEffect, useRef, useState } from 'react'
import './youtube.css'

// The YouTube widget of the home page's old "combined widget" (combined_widget.html, which was hosted on R2): the most
// recent video of Parking Radio's channel, behind a cover that plays it, or "Hors direct" when there's none. It's meant
// to show the live stream when the channel is live, but doesn't detect it yet: the original tried, and never could.
//
// It pauses the legacy radio bar when it plays, and the other way around, through a BroadcastChannel (see
// legacy-radio.tsx).

const API_KEY = 'AIzaSyBRcPalxY-XIncjXmTjbwj1RjrN2MTRKX8'
const CHANNEL_ID = 'UCvMw4qUIPPwkcZmBRRS0vNA'
const POLL_MS = 60000

// Shared with legacy-radio.tsx: each one says when it starts playing, and pauses when the other one does.
const CHANNEL = 'parking_radio'
const PLAYING = 'yt_playing'
const OTHER_PLAYING = 'audio_playing'

// What the widget shows. Until the channel's videos are known, it's the cover, without a video to play.
type Video = { kind: 'unknown' } | { kind: 'offline' } | { kind: 'cover' | 'playing'; id: string }

// What the YouTube Data API answers, as far as the widget reads it.
type ApiResponse<Item> = { error?: { code: number; message: string }; items?: Item[] }
type ChannelItem = { contentDetails: { relatedPlaylists: { uploads: string } } }
type PlaylistItem = { snippet: { resourceId: { videoId: string } } }

export function YouTubeWidget() {
  const [video, setVideoState] = useState<Video>({ kind: 'unknown' })
  const [error, setError] = useState<string | null>(null)
  // What's shown, for the polling and the channel, which outlive renders.
  const current = useRef(video)
  const channel = useRef<BroadcastChannel | null>(null)

  const setVideo = useCallback((next: Video) => {
    current.current = next
    setVideoState(next)
  }, [])

  useEffect(() => {
    const stopped = new AbortController()
    const { signal } = stopped

    try {
      channel.current = new BroadcastChannel(CHANNEL)
      channel.current.addEventListener('message', (e) => {
        const shown = current.current
        if (e.data === OTHER_PLAYING && shown.kind === 'playing') setVideo({ kind: 'cover', id: shown.id })
      })
    } catch {
      // Without BroadcastChannel, the radio and the video just don't pause each other.
    }

    // The first item the API answers `query` with, if any. Throws an error to show for the API's own errors, and when
    // the request fails.
    async function first<Item>(query: string): Promise<Item | undefined> {
      const response = await fetch(`https://www.googleapis.com/youtube/v3/${query}&key=${API_KEY}`, { signal })
      const data: ApiResponse<Item> = await response.json()
      signal.throwIfAborted()
      if (data.error) throw new Error(`API ${data.error.code}: ${data.error.message}`)
      return data.items?.[0]
    }

    async function check() {
      try {
        const channelItem = await first<ChannelItem>(`channels?part=contentDetails&id=${CHANNEL_ID}`)
        setError(null)
        if (!channelItem) {
          setVideo({ kind: 'offline' })
          return
        }
        // While a video waits behind its cover, there's no looking for a newer one: only when there's none yet, or
        // while one plays, which a newer one replaces.
        if (current.current.kind === 'cover') return
        const uploads = channelItem.contentDetails.relatedPlaylists.uploads
        const latest = await first<PlaylistItem>(`playlistItems?part=snippet&playlistId=${uploads}&maxResults=1`)
        if (!latest) {
          setVideo({ kind: 'offline' })
          return
        }
        const id = latest.snippet.resourceId.videoId
        const shown = current.current
        if (!('id' in shown) || shown.id !== id) setVideo({ kind: 'cover', id })
      } catch (e) {
        if (!signal.aborted) setError(e instanceof Error ? e.message : String(e))
      }
    }

    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      stopped.abort()
      clearInterval(timer)
      channel.current?.close()
      channel.current = null
    }
  }, [setVideo])

  const play = () => {
    if (video.kind !== 'cover') return
    setVideo({ kind: 'playing', id: video.id })
    channel.current?.postMessage(PLAYING)
  }

  return (
    <div className="youtube">
      <div className="youtube-player">
        {video.kind === 'playing' && (
          <iframe
            title="Parking Radio YouTube"
            src={`https://www.youtube.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1`}
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        )}
        {(video.kind === 'unknown' || video.kind === 'cover') && (
          <div className="youtube-cover" onClick={play}>
            {video.kind === 'cover' && <img src={`https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`} alt="" />}
            <div className="youtube-cover-button">
              <svg width="18" height="20" viewBox="0 0 10 12" fill="none">
                <path d="M1 1l8 5-8 5V1z" fill="#fff" />
              </svg>
            </div>
          </div>
        )}
        {video.kind === 'offline' && <div className="youtube-offline">Hors direct</div>}
      </div>
      {error && <div className="youtube-error">⚠ {error}</div>}
    </div>
  )
}
