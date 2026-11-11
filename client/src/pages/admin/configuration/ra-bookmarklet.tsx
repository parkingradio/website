import type { MouseEvent } from 'react'
import { useEnvironmentStamp } from '../../../config-context'

// The bookmarklet that publishes a session's event on RA, in the configuration section (see
// docs/design/client/admin/publier-sur-ra.md). It loads its code from this site each time it's clicked, so that fixing it
// never requires reinstalling it.

// The bookmarklet's code: it adds a script to RA's page, from `origin`, which a query that changes each time keeps from
// being cached.
function bookmarklet(origin: string): string {
  const script = JSON.stringify(`${origin}/ra-bookmarklet.js?`)
  return `javascript:(()=>{const s=document.createElement('script');s.src=${script}+Date.now();document.body.append(s)})()`
}

export function RaBookmarklet() {
  // Outside production, its name says which environment it's from, so that admins tell their bookmarks apart.
  const stamp = useEnvironmentStamp()
  return (
    <>
      <p>
        Pour créer l'événement d'une session sur RA depuis sa page, glissez ce lien dans la barre de favoris de votre
        navigateur&nbsp;:{' '}
        <a
          className="admin-bookmarklet"
          // React refuses links to `javascript:`, which a bookmarklet is, so it's set on the element itself.
          ref={(link) => link?.setAttribute('href', bookmarklet(window.location.origin))}
          onClick={(event: MouseEvent) => event.preventDefault()}
        >
          Parking Radio → RA{stamp && ` [${stamp}]`}
        </a>
      </p>
      <p>
        Puis, sous «&nbsp;Événement RA&nbsp;» d'une session, cliquez sur «&nbsp;créer&nbsp;», puis sur «&nbsp;Publier sur
        RA&nbsp;», connectez-vous à RA si besoin, et cliquez sur ce favori&nbsp;: il vous montre l'événement avant de le
        créer. Il charge son code depuis ce site à chaque fois, et n'a donc jamais besoin d'être réinstallé.
      </p>
    </>
  )
}
