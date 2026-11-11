import { Features } from './configuration/features'
import { RaBookmarklet } from './configuration/ra-bookmarklet'
import { Recipients } from './configuration/recipients'
import { SoundCloudCredentials } from './configuration/soundcloud'
import { YouTubeCredentials } from './configuration/youtube'

// The settings that change what the site does: who applications are emailed to, the SoundCloud app the server reads
// SoundCloud through, the YouTube channel it reads the site's video from, the bookmarklet that publishes sessions' events
// on RA, and the feature flags.
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

      <h2>Publier sur RA</h2>
      <RaBookmarklet />

      <h2>Features</h2>
      <Features />
    </>
  )
}
