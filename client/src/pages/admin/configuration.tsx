import { CalendarFeeds } from './configuration/calendar-feeds'
import { Features } from './configuration/features'
import { Recipients } from './configuration/recipients'
import { SoundCloudCredentials } from './configuration/soundcloud'
import { YouTubeCredentials } from './configuration/youtube'

// The settings that change what the site does: who applications are emailed to, the SoundCloud app the server reads
// SoundCloud through, the YouTube channel it reads the site's video from, the calendars that the studio's occupations
// and quiet time are read from, and the feature flags.
export function Configuration() {
  return (
    <>
      <h1>Configuration</h1>

      <h2>Envoi des candidatures par e-mail</h2>
      <Recipients />

      <h2>Connexion SoundCloud</h2>
      <SoundCloudCredentials />

      <h2>Connexion YouTube</h2>
      <YouTubeCredentials />

      <h2>Calendriers externes</h2>
      <CalendarFeeds />

      <h2>Features</h2>
      <Features />
    </>
  )
}
