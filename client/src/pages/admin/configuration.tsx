import { Features } from './configuration/features'
import { Recipients } from './configuration/recipients'

// The settings that change what the site does: who applications are emailed to, and the feature flags.
export function Configuration() {
  return (
    <>
      <h1>Configuration</h1>

      <h2>Envoi des candidatures par e-mail</h2>
      <Recipients />

      <h2>Features</h2>
      <Features />
    </>
  )
}
