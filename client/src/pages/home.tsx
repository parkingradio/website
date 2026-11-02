import { RotationBanner } from './home/rotation-banner'
import { YouTubeWidget } from './home/youtube'
import './home.css'

const DISCORD_CHAT_URL = 'https://e.widgetbot.io/channels/1516532918527328428/1516532918527328431'

// The home page: the rotation banner, Parking Radio's YouTube channel and its Discord chat. The last two used to be part
// of a single "combined widget", an iframe of a page hosted on R2, which they were ported from without changing their
// look.
export function Home() {
  return (
    <div className="home">
      <RotationBanner />
      <YouTubeWidget />
      <div className="home-spacer" />
      {/* WidgetBot's embed of a channel of our Discord server. */}
      <div className="home-chat">
        <iframe title="Parking Radio Discord" src={DISCORD_CHAT_URL} allow="clipboard-write; fullscreen" />
      </div>
    </div>
  )
}
