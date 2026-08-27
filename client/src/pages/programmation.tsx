import './programmation.css'

const RA_PROMOTER_URL = 'https://ra.co/promoters/183980'

export function Programmation() {
  return (
    <div className="programmation">
      <p>Consultez tous les événements à venir de Parking Radio sur Resident Advisor.</p>
      <a href={RA_PROMOTER_URL} target="_blank" rel="noreferrer">
        Voir la programmation sur Resident Advisor
      </a>
    </div>
  )
}
