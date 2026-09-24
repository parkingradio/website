import { useEffect, useState } from 'react'
import { useAssetUrl } from '../config-context'
import './synth-meetups.css'

// Most recent first, so the gallery shows newer posters higher up.
const POSTERS = [
  {
    key: 'synth_meetups_2026_septembre.jpg',
    alt: 'Affiche du synth meetup du 23 septembre 2026',
  },
  {
    key: 'synth_meetups_2026_aout.jpg',
    alt: 'Affiche des synth meetups des 12 et 26 août 2026',
  },
  {
    key: 'synth_meetups_2026_juillet.jpg',
    alt: 'Affiche des synth meetups des 8, 22 et 29 juillet 2026',
  },
  {
    key: '2026.05.30_droneDayFlyer.jpeg',
    alt: 'Affiche du Drone Day du 30 mai 2026',
  },
  {
    key: 'synth_meetups_2026_mai.jpg',
    alt: 'Affiche des synth meetups des 6, 13 et 28 mai 2026',
  },
  {
    key: 'synth_meetups_2026_avril.jpg',
    alt: 'Affiche des synth meetups des 8, 15 et 22 avril 2026',
  },
  {
    key: 'synth_meetups_2026_avril_01.jpg',
    alt: 'Affiche du synth meetup du 1er avril 2026',
  },
  {
    key: 'synth_meetups_2026_general.jpeg',
    alt: 'Affiche des synth meetups, les mercredis à 18h',
  },
]

const NDI_URL = 'https://ndi.video/tools/'

export function SynthMeetups() {
  const assetUrl = useAssetUrl()
  const [expandedPoster, setExpandedPoster] = useState<(typeof POSTERS)[number] | null>(null)

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
      <img className="banner" src={assetUrl('synth_meetups_banner.gif')} alt="Synth Meetups" />

      <div className="content">
        <p>les <i>synth meetups</i> c'est des rencontres hebdomadaires de création sonore et audiovisuelle.</p>
        <p>c'est l'occasion de soulever le capot du parking pour apprendre la technique derrière notre studio.</p>
        <p>vous êtes invité.es à tester des idées, brainstormer, rencontrer des collaborateurs.</p>

        <h2>dates à venir</h2>
        <ul>
          <li>mercredi 23 septembre 2026</li>
          <li>mercredi 7 octobre 2026</li>
          <li>mercredi 14 octobre 2026</li>
          <li>mercredi 21 octobre 2026</li>
          <li>mercredi 28 octobre 2026</li>
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
          <strong>
            une approche temps-réel est priorisée afin de rapprocher les artistes de leur médium et de sa
            diffusion.
          </strong>
        </p>
        <p>
          en gros, l'artiste se pointe au parking avec son laptop et shoot ses visuels direct dans le
          plafond en format vidéo. il suffit d'envoyer de la vidéo au système via réseau en utilisant{' '}
          <a href={NDI_URL} target="_blank" rel="noreferrer">
            NDI
          </a>
          . la vidéo sera automatiquement redimensionnée pour couvrir la surface.
        </p>
        <p>
          <strong>spécifications</strong>
        </p>
        <ul>
          <li>
            résolution réel: <strong>240x20px</strong>, (aspect ratio 4x3.8)
          </li>
          <li>
            équivalent en pixel carrés: <strong>240x228</strong>, frame rate fixe, à votre choix.
          </li>
        </ul>

        <h2>évènements passés</h2>
      </div>

      <div className="gallery">
        {POSTERS.map((poster) => (
          <button
            key={poster.key}
            className="poster-thumb"
            onClick={() => setExpandedPoster(poster)}
            aria-label={`Voir en grand: ${poster.alt}`}
          >
            <img src={assetUrl(poster.key)} alt={poster.alt} />
          </button>
        ))}
      </div>

      {expandedPoster && (
        <div className="lightbox" onClick={() => setExpandedPoster(null)}>
          <img src={assetUrl(expandedPoster.key)} alt={expandedPoster.alt} />
        </div>
      )}
    </div>
  )
}