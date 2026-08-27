import { useEffect, useState } from 'react'
import './synth-meetups.css'

// TODO: these are placeholders. Replace with real assets once we decide where poster images are hosted.
const BANNER_URL = 'https://placehold.co/1456x619?text=Synth+Meetups'
const POSTERS = [
  'https://placehold.co/561x998?text=Poster+1',
  'https://placehold.co/561x998?text=Poster+2',
  'https://placehold.co/561x998?text=Poster+3',
  'https://placehold.co/561x998?text=Poster+4',
  'https://placehold.co/561x998?text=Poster+5',
  'https://placehold.co/561x998?text=Poster+6',
  'https://placehold.co/561x998?text=Poster+7',
]

const NDI_URL = 'https://ndi.video/tools/'

export function SynthMeetups() {
  const [expandedPoster, setExpandedPoster] = useState<string | null>(null)

  useEffect(() => {
    if (!expandedPoster) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedPoster(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expandedPoster])

  return (
    <div className="synth-meetups">
      <img className="banner" src={BANNER_URL} alt="Synth Meetups" />

      <div className="content">
        <p>les synth meetups c'est des rencontres hebdomadaires de création sonore et audiovisuelle.</p>
        <p>c'est l'occasion de soulever le capot du parking pour apprendre la technique derrière notre studio.</p>
        <p>vous êtes invité.es à tester des idées, brainstormer, rencontrer des collaborateurs.</p>

        <h2>dates à venir</h2>
        <ul>
          <li>mercredi 22 juillet 2026</li>
          <li>mercredi 29 juillet 2026</li>
          <li>mercredi 12 août 2026</li>
          <li>mercredi 26 août 2026</li>
          <li>mercredi 2 septembre 2026</li>
        </ul>

        <h2>mandat</h2>
        <ul>
          <li>désacraliser l'accès aux contextes de diffusion.</li>
          <li>partager le savoir concernant les pratiques de création temps-réel numériques.</li>
          <li>favoriser les processus collaboratifs.</li>
          <li>archiver les pratiques éphémères.</li>
        </ul>

        <h2>le plafond</h2>
        <p>vous êtes invitez à tester du contenu visuel, audio réactif ou pas, conçu pour notre plafond.</p>
        <p>voici comment:</p>
        <p>
          le plafond lumineux regroupe près de 5000 LEDs adressables pour former un "écran". ainsi, la
          création de contenu est simplifié; nul besoin de savoir programmer.
        </p>
        <p>
          une approche temps-réel est priorisée afin de rapprocher les artistes de leur médium et de sa
          diffusion.
        </p>
        <p>
          en gros, l'artiste se pointe au parking avec son laptop et shoot ses visuels direct dans le
          plafond en format vidéo. il suffit d'envoyer de la vidéo au système via réseau en utilisant{' '}
          <a href={NDI_URL} target="_blank" rel="noreferrer">
            NDI
          </a>
          . la vidéo sera automatiquement redimensionnée pour couvrir la surface.
        </p>
        <p>spécifications</p>
        <ul>
          <li>résolution réel: 240x20px, (aspect ratio 4x3.8)</li>
          <li>équivalent en pixel carrés: 240x228, frame rate fixe, à votre choix.</li>
        </ul>

        <h2>évènements passés</h2>
      </div>

      <div className="gallery">
        {POSTERS.map((url, index) => (
          <button
            key={url}
            className="poster-thumb"
            onClick={() => setExpandedPoster(url)}
            aria-label={`Voir l'affiche de l'évènement ${index + 1}`}
          >
            <img src={url} alt={`Affiche de l'évènement ${index + 1}`} />
          </button>
        ))}
      </div>

      {expandedPoster && (
        <div className="lightbox" onClick={() => setExpandedPoster(null)}>
          <img src={expandedPoster} alt="Affiche de l'évènement, en grand" />
        </div>
      )}
    </div>
  )
}