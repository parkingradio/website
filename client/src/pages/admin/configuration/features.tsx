import { useState } from 'react'
import { api } from '../../../api/client'
import type { FeatureId, Schema } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { FEATURE_LABELS, byWhom } from '../describe'

// The feature flags, in the configuration section.
export function Features() {
  const loaded = useApi('/api/admin/features')

  return (
    <>
      <p>
        Ces interrupteurs activent ou désactivent des parties du site sans le redéployer, par exemple pour revenir à
        l'ancienne version d'une page qui a un problème. Les visiteurs voient le changement dès qu'ils chargent une page du
        site.
      </p>
      {loaded.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les features n'ont pas pu être chargées&nbsp;: {loaded.message}
        </p>
      )}
      {loaded.kind === 'loaded' &&
        (loaded.value.features.length === 0 ? (
          <p className="admin-placeholder">Aucune feature pour le moment.</p>
        ) : (
          <ul className="admin-features">
            {loaded.value.features.map((feature) => (
              <FeatureSwitch key={feature.id as FeatureId} loaded={feature} />
            ))}
          </ul>
        ))}
    </>
  )
}

// A flag, which is saved as soon as it's switched.
function FeatureSwitch({ loaded }: { loaded: Schema<'Feature'> }) {
  // The API's types can't tell that it's a FeatureId while there are no flags (see FeatureId).
  const id = loaded.id as FeatureId
  const [feature, setFeature] = useState(loaded)
  const [busy, setBusy] = useState(false)
  // Why the flag couldn't be switched, if it couldn't.
  const [error, setError] = useState<string | null>(null)
  const { name, description } = FEATURE_LABELS[id]
  const changed = byWhom(feature.enabled ? 'Activée' : 'Désactivée', feature.updatedBy, feature.updatedAt)

  const toggle = async (enabled: boolean) => {
    setBusy(true)
    const result = await api.PUT('/api/admin/features/{id}', { params: { path: { id } }, body: { enabled } })
    setBusy(false)
    setError(result.ok ? null : result.error)
    if (result.ok) setFeature(result.feature)
  }

  return (
    <li>
      <label>
        <input
          type="checkbox"
          role="switch"
          checked={feature.enabled}
          disabled={busy}
          onChange={(event) => toggle(event.target.checked)}
        />
        {name}
      </label>
      <p>{description}</p>
      {changed && <p className="admin-meta">{changed}</p>}
      {error && (
        <p className="admin-error" role="alert">
          La feature n'a pas pu être {feature.enabled ? 'désactivée' : 'activée'}&nbsp;: {error}
        </p>
      )}
    </li>
  )
}
