import { AcceptInvite } from './accept-invite'
import { Autoriser } from './autoriser'
import { AdminLayout } from './layout'
import { Admins } from './admins'
import { Calendrier } from './calendrier'
import { Rotation } from './rotation'
import { RotationLegacy } from './rotation-legacy'
import { ApplicationPage, ApplicationsPage, NewApplicationPage } from './applications'
import { ArtistPage, ArtistsPage, NewArtistPage } from './artists'
import { CollectivePage, NewCollectivePage } from './collectives'
import { NewSessionPage, SessionPage, SessionsPage } from './sessions'
import { Integrations } from './integrations'
import { Configuration } from './configuration'
import './admin.css'

// Every page behind AdminShell (see AdminPage in shell.tsx).
const pages = {
  AcceptInvite,
  Autoriser,
  AdminLayout,
  Admins,
  Calendrier,
  Rotation,
  RotationLegacy,
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

export default function AdminPage({ page }: { page: keyof typeof pages }) {
  const Page = pages[page]
  return <Page />
}
