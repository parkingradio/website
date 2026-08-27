import { IframeEmbed } from '../iframe-embed'

const GOOGLE_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSctvcYT2JPzdP446KPiHf6ipRwmZUSlPqMvCGTIyk4Wrptjlw/viewform'

export function Appliquer() {
  return <IframeEmbed src={GOOGLE_FORM_URL} title="Parking Radio Appliquer" />
}
