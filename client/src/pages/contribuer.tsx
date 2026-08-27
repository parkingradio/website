import { IframeEmbed } from '../iframe-embed'

const ZEFFY_URL = 'https://www.zeffy.com/embed/donation-form/contribuer-a-parkingradio'

export function Contribuer() {
  return <IframeEmbed src={ZEFFY_URL} title="Parking Radio Contribuer" allow="payment" />
}
