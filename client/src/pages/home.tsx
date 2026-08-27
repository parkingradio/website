import { IframeEmbed } from '../iframe-embed'

const WIDGET_URL = 'https://pub-ac6abcc67fed4f8f8072bac54bb99274.r2.dev/combined_widget.html'

export function Home() {
  return (
    <IframeEmbed
      src={WIDGET_URL}
      title="Parking Radio"
      allow="autoplay; encrypted-media"
    />
  )
}
