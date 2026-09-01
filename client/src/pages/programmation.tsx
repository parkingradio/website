import { IframeEmbed } from '../iframe-embed'

const RA_WIDGET_URL =
  'https://ra.co/promoters/183980/widget/events?theme=light&transparentBackground=true&customBackgroundColor=&customTextColor=%23000000'

export function Programmation() {
  return <IframeEmbed src={RA_WIDGET_URL} title="Parking Radio Programmation" />
}
