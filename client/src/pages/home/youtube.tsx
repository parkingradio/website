import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Result, Schema } from '../../api/client'
import { usePlayer } from '../../player/player-context'
import './youtube.css'

// The YouTube widget of the home page's old "combined widget" (combined_widget.html, which was hosted on R2): the video
// the server says the site shows (see docs/design/server/video.md), behind a cover that plays it, or "Hors direct" when
// there's none. It asks again a minute after each answer, and always shows what loading the page again would, even if
// that stops the video being watched. When the server can't say, it keeps what it shows.
//
// It pauses the radio when it plays, and the radio playing stops it.

const POLL_MS = 60000

// What the widget shows. Until the server says, it's the cover, without a video to play.
type Video = { kind: 'unknown' } | { kind: 'offline' } | { kind: 'cover' | 'playing'; id: string }

// What to show after `shown`, given the server's answer: the video it says, behind its cover, unless it's the one shown,
// or "Hors direct" when there's none. When the server can't say, what's shown stays, unless nothing is yet.
function next(shown: Video, answer: Result<Schema<'Video'>>): Video {
  if (!answer.ok) return shown.kind === 'unknown' ? { kind: 'offline' } : shown
  if (!answer.video) return shown.kind === 'offline' ? shown : { kind: 'offline' }
  return 'id' in shown && shown.id === answer.video.id ? shown : { kind: 'cover', id: answer.video.id }
}

export function YouTubeWidget() {
  const player = usePlayer()
  const [video, setVideo] = useState<Video>({ kind: 'unknown' })

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // Asks again a minute after each answer, rather than every minute, so that a late answer never replaces a newer one.
    async function check() {
      const answer = await api.GET('/api/video')
      if (stopped) return
      setVideo((shown) => next(shown, answer))
      timer = setTimeout(check, POLL_MS)
    }

    check()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])

  // The radio starting to play stops the video, which goes back to its cover. Playing the video pauses the radio first, so
  // that doesn't stop it.
  const radioPlaying = player.playing !== null
  const [radioWasPlaying, setRadioWasPlaying] = useState(radioPlaying)
  if (radioPlaying !== radioWasPlaying) {
    setRadioWasPlaying(radioPlaying)
    if (radioPlaying && video.kind === 'playing') setVideo({ kind: 'cover', id: video.id })
  }

  const play = () => {
    if (video.kind !== 'cover') return
    player.pause()
    setVideo({ kind: 'playing', id: video.id })
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
    </div>
  )
}
