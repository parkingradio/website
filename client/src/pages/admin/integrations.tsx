import { ConnectClaude, ConnectedApps } from './integrations/connections'
import { RaBookmarklet } from './integrations/ra-bookmarklet'

// What lets other apps and sites work with the admin pages: connecting Claude, the apps the admin connected, and the
// bookmarklet that publishes sessions' events on RA.
export function Integrations() {
  return (
    <>
      <h1>Intégrations</h1>

      <h2>Connecter Claude</h2>
      <ConnectClaude />

      <h2>Vos applications connectées</h2>
      <ConnectedApps />

      <h2>Publier sur RA</h2>
      <RaBookmarklet />
    </>
  )
}
