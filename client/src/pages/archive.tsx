import { IframeEmbed } from '../iframe-embed'

const SOUNDCLOUD_URL =
  'https://w.soundcloud.com/player/?url=https://soundcloud.com/parkingdotradio&visual=false&buying=false&liking=true&download=false&sharing=true&show_comments=true&show_playcount=true&show_teaser=true&show_user=false&hide_related=true&show_reposts=true&callback=true'

export function Archive() {
  return <IframeEmbed src={SOUNDCLOUD_URL} title="Parking Radio Archives" allow="autoplay" />
}
