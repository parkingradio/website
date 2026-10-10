import { Features } from './configuration/features'
import { Recipients } from './configuration/recipients'
import { SoundCloudCredentials } from './configuration/soundcloud'

// The settings that change what the site does: who applications are emailed to, the SoundCloud app the radio reads
// playlists through, and the feature flags.
export function Configuration() {
  return (
    <>
      <h1>Configuration</h1>

      <h2>Envoi des candidatures par e-mail</h2>
      <Recipients />

      <h2>Application SoundCloud</h2>
      <SoundCloudCredentials />

      <h2>Features</h2>
      <Features />
    </>
  )
}
