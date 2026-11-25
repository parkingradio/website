import { AcceptInvite } from './accept-invite'
import { Autoriser } from './autoriser'
import { AdminLayout } from './layout'
import { Admins } from './admins'
import { Calendrier } from './calendrier'
import { Rotation } from './rotation'
import { ApplicationPage, ApplicationsPage, NewApplicationPage } from './applications'
import { ArtistPage, ArtistsPage, NewArtistPage } from './artists'
import { CollectivePage, NewCollectivePage } from './collectives'
import { NewSessionPage, SessionPage, SessionsPage } from './sessions'
import { Integrations } from './integrations'
import { Configuration } from './configuration'
import './admin.css'

// Every page behind AdminShell, loaded on demand, all at once (see AdminPage in shell.tsx).
const pages = {
  AcceptInvite,
  Autoriser,
  AdminLayout,
  Admins,
  Calendrier,
  Rotation,
  ApplicationsPage,
  NewApplicationPage,
  ApplicationPage,
  SessionsPage,
  NewSessionPage,
  SessionPage,
  ArtistsPage,
  NewArtistPage,
  ArtistPage,
  NewCollectivePage,
  CollectivePage,
  Integrations,
  Configuration,
}

// One component for every page, rather than one each, since React waits for a component that's loaded on demand the
// first time it's shown, even once its module is there, which would hide the admin menu for a moment at each new page.
export default function AdminPage({ page }: { page: keyof typeof pages }) {
  const Page = pages[page]
  return <Page />
}
