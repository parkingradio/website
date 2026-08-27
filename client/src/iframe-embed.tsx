import './iframe-embed.css'

type IframeEmbedProps = {
  src: string
  title: string
  allow?: string
}

export function IframeEmbed({ src, title, allow }: IframeEmbedProps) {
  return <iframe src={src} title={title} allow={allow} className="iframe-embed" />
}
