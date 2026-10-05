import { Link } from 'react-router'
import './not-found.css'

// Shown for any URL that isn't a page of the site.
export function NotFound() {
  return (
    <div className="not-found">
      <h1>Page introuvable</h1>
      <p>Cette page n'existe pas.</p>
      <Link to="/">retour à l'accueil</Link>
    </div>
  )
}
