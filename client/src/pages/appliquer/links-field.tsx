import { useState } from 'react'
import { LINK_SITES, isAddress, parseLink } from 'shared/artists'
import type { LinkSiteId } from 'shared/artists'
import { DEFAULT_LINK_SITES } from './choices'

type Props = {
  // What the artist typed in each field, as-is.
  values: Partial<Record<LinkSiteId, string>>
  onChange: (values: Partial<Record<LinkSiteId, string>>) => void
  // Show every field's error, not only those the artist has left (set when the form is submitted).
  showErrors: boolean
  // Whether the links are wrong as a whole, e.g. when there's none.
  invalid: boolean
}

// One field per site, showing the site's address around the profile name. What's typed is reduced to what's kept, e.g.
// an address to the profile name, as soon as it's pasted, or else when leaving the field. Until then, an address shows
// without the site's address around it, which would show twice. A paste that can't be read says why right away.
export function LinksField({ values, onChange, showErrors, invalid }: Props) {
  // The fields shown on top of the default ones.
  const [shown, setShown] = useState<LinkSiteId[]>([])
  const [left, setLeft] = useState<Set<LinkSiteId>>(new Set())
  // A field added with a button gets the focus, so the artist can type right away.
  const [added, setAdded] = useState<LinkSiteId | null>(null)
  const visible = LINK_SITES.filter((site) => DEFAULT_LINK_SITES.includes(site.id) || shown.includes(site.id))
  const hidden = LINK_SITES.filter((site) => !DEFAULT_LINK_SITES.includes(site.id) && !shown.includes(site.id))
  const fieldError = (siteId: LinkSiteId, error: string | undefined) => !!error && (showErrors || left.has(siteId))
  // When the links are wrong but none of them says why, e.g. when there's none, the first one is marked as wrong, so
  // that the form brings the artist to it.
  const firstWrong = invalid && !visible.some((site) => fieldError(site.id, parseLink(site, values[site.id] ?? '').error))

  return (
    <>
      <div className="links">
        {visible.map((site) => {
          const raw = values[site.id] ?? ''
          const { value, error } = parseLink(site, raw)
          const showError = fieldError(site.id, error)
          const affixes = site.profile && !isAddress(site, raw)
          const leave = () => setLeft((current) => new Set(current).add(site.id))
          return (
            <div key={site.id} className={showError ? 'link bad' : value ? 'link ok' : 'link'}>
              <div className="link-head">
                <label htmlFor={`link-${site.id}`}>{site.name}</label>
                {!DEFAULT_LINK_SITES.includes(site.id) && (
                  <button
                    type="button"
                    className="remove"
                    onClick={() => {
                      setShown(shown.filter((id) => id !== site.id))
                      const rest = { ...values }
                      delete rest[site.id]
                      onChange(rest)
                    }}
                  >
                    enlever
                  </button>
                )}
              </div>
              <div className={site.profile ? 'affix' : 'affix full'}>
                {affixes && site.prefix && <span className="prefix">{site.prefix}</span>}
                <input
                  id={`link-${site.id}`}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={showError || (firstWrong && site === visible[0]) ? true : undefined}
                  autoFocus={site.id === added}
                  // The site's address around the field says what goes there, so only the website's field has a placeholder.
                  placeholder={site.profile ? undefined : 'https://…'}
                  value={raw}
                  onChange={(event) => onChange({ ...values, [site.id]: event.target.value })}
                  onPaste={(event) => {
                    const pasted = event.clipboardData.getData('text')
                    const parsed = parseLink(site, pasted)
                    if (parsed.error) {
                      leave()
                    } else if (parsed.value && parsed.value !== pasted.trim()) {
                      // What's kept of a pasted address is a whole answer: it replaces what was there.
                      event.preventDefault()
                      onChange({ ...values, [site.id]: parsed.value })
                    }
                  }}
                  onBlur={() => {
                    leave()
                    if (value && value !== raw) onChange({ ...values, [site.id]: value })
                  }}
                />
                {affixes && site.subdomainOf && <span className="suffix">.{site.subdomainOf}</span>}
              </div>
              <span className="link-status" aria-live="polite">
                {value ? (
                  <>
                    ✓{' '}
                    <a href={site.url(value)} target="_blank" rel="noreferrer">
                      vérifier le lien ↗
                    </a>
                  </>
                ) : showError ? (
                  error
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
      {hidden.length > 0 && (
        <div className="add-links">
          <span>ajouter :</span>
          {hidden.map((site) => (
            <button
              key={site.id}
              type="button"
              onClick={() => {
                setShown([...shown, site.id])
                setAdded(site.id)
              }}
            >
              + {site.name}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
