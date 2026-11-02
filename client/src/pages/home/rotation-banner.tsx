import type { Schema } from '../../api/client'
import { useApi } from '../../api/use-api'
import './rotation-banner.css'

// The banner at the top of the home page: the artists of the radio's rotation, from the set on air, once per set,
// scrolling from right to left in a loop.
export function RotationBanner() {
  const radio = useApi('/api/radio')
  if (radio.kind === 'error') return null
  const text = radio.kind === 'loaded' ? names(radio.value) : null
  return (
    <div className="rotation-banner">
      {text && (
        <div ref={scroll} className="rotation-banner-track">
          <span>{text}</span>
          <span aria-hidden="true">{text}</span>
        </div>
      )}
    </div>
  )
}

function names({ current, upcoming }: Schema<'Radio'>): string {
  return [current.track, ...upcoming].map(({ artist }) => `${artist} · `).join('')
}

// The names are there twice in a row, and scroll by the width of one of the two, so that they loop without a gap. The
// width is in ems, so that the speed stays the same whatever the font size (see rotation-banner.css).
function scroll(track: HTMLElement | null) {
  if (!track) return
  const width = track.scrollWidth / 2 / parseFloat(getComputedStyle(track).fontSize)
  track.style.setProperty('--width', String(width))
}
