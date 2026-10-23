import { useEffect, useRef } from 'react'

const BAR_WIDTH = 2
const BAR_STEP = 4
// How fast it scrolls while the radio plays, in bars per second.
const BARS_PER_SECOND = 14

// A number from 0 to 1 that looks random but is always the same for the same `n`.
function noise(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// The height of bar `i`, from 0.12 to 1, for a set whose shape is `seed`: smooth waves, with a little noise.
function barHeight(i: number, seed: number): number {
  const smooth = 0.55 * Math.sin(i * 0.19 + seed) + 0.3 * Math.sin(i * 0.051 + seed * 1.7) + 0.15 * Math.sin(i * 0.9 + seed * 3.1)
  return Math.min(1, Math.max(0.12, 0.5 + 0.35 * smooth + 0.35 * (noise(i + seed * 1000) - 0.5)))
}

// A track's shape, from its id.
function seedOf(id: string): number {
  let seed = 0
  for (const char of id) seed = (seed * 31 + char.charCodeAt(0)) % 1000
  return seed + 1
}

/**
 * A waveform that isn't drawn from the sound (the audio is on SoundCloud's CDN, out of reach of the page): a shape of
 * its own for each track, which scrolls to the left while `moving`, and stands still, dimmed, otherwise. It doesn't
 * scroll for visitors who asked their system for less motion.
 */
export function Waveform({ trackId, moving }: { trackId: string; moving: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const shift = useRef(0)

  useEffect(() => {
    const element = canvas.current!
    const context = element.getContext('2d')
    if (!context) return
    const seed = seedOf(trackId)
    const still = !moving || matchMedia('(prefers-reduced-motion: reduce)').matches
    let last = performance.now()
    let frame = 0

    const draw = (now: number) => {
      if (!still) shift.current += ((now - last) / 1000) * BARS_PER_SECOND
      last = now
      const ratio = devicePixelRatio || 1
      const width = element.clientWidth
      const height = element.clientHeight
      // A hidden waveform (e.g. on phones) is drawn again when its size changes, like a still one.
      if (width === 0) return
      if (element.width !== Math.round(width * ratio)) element.width = Math.round(width * ratio)
      if (element.height !== Math.round(height * ratio)) element.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.fillStyle = moving ? '#f9f9f9' : '#555'
      const first = Math.floor(shift.current)
      const offset = (shift.current - first) * BAR_STEP
      for (let k = 0; k * BAR_STEP - offset < width; k++) {
        const barHeightPx = Math.max(2, Math.round(barHeight(first + k, seed) * height))
        context.fillRect(Math.round(k * BAR_STEP - offset), Math.round((height - barHeightPx) / 2), BAR_WIDTH, barHeightPx)
      }
      // A still waveform only has to be drawn again when its size changes.
      if (!still) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      last = performance.now()
      frame = requestAnimationFrame(draw)
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [trackId, moving])

  return <canvas ref={canvas} className="player-wave" aria-hidden="true" />
}
