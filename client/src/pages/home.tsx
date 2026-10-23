import { useFeature } from '../config-context'
import { LegacyRadio } from './home/legacy-radio'
import { RotationBanner } from './home/rotation-banner'
import { YouTubeWidget } from './home/youtube'
import './home.css'

const DISCORD_CHAT_URL = 'https://e.widgetbot.io/channels/1516532918527328428/1516532918527328431'

// The home page: the legacy radio bar, Parking Radio's YouTube channel and its Discord chat. They used to be a single
// "combined widget", an iframe of a page hosted on R2, which they were ported from without changing their look. The
// player shared by every page replaces the legacy radio bar while its feature flag is on, and the rotation banner takes
// its place: neither shows until the flag is known.
export function Home() {
  const newPlayer = useFeature('nouveau-lecteur')
  return (
    <div className="home">
      {newPlayer === false && <LegacyRadio />}
      {newPlayer === true && <RotationBanner />}
      <YouTubeWidget />
      <div className="home-spacer" />
      {/* WidgetBot's embed of a channel of our Discord server. */}
      <div className="home-chat">
        <iframe title="Parking Radio Discord" src={DISCORD_CHAT_URL} allow="clipboard-write; fullscreen" />
      </div>
    </div>
  )
}
