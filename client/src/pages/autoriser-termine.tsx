import { useSearchParams } from 'react-router'
import './autoriser-termine.css'

// Where an app, e.g. the Parking Radio CLI, sends the browser once it's done connecting, with `failed` in the query when
// it couldn't connect (see "Once the app is done connecting" in docs/design/client/admin/autoriser.md). Anyone can link
// here, so it shows nothing from the address.
export function AutoriserTermine() {
  const [searchParams] = useSearchParams()
  const [title, text] = searchParams.has('failed')
    ? ['Échec de connexion', "L'application n'a pas pu être connectée à Parking Radio. Revenez à l'application pour savoir pourquoi."]
    : ['Application connectée', "L'application est maintenant connectée à Parking Radio. Vous pouvez fermer cet onglet."]
  return (
    <div className="autoriser-termine">
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  )
}
