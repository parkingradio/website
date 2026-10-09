import { useFeature } from '../config-context'
import { IframeEmbed } from '../iframe-embed'
import { ApplicationForm } from './appliquer/form'

const GOOGLE_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSctvcYT2JPzdP446KPiHf6ipRwmZUSlPqMvCGTIyk4Wrptjlw/viewform'

// Our own form once its feature flag is on, and the original Google Form otherwise, e.g. if ours has a problem. Nothing
// until the flag is known, rather than one then the other.
export function Appliquer() {
  const newForm = useFeature('nouveau-formulaire-candidature')
  if (newForm === undefined) return null
  return newForm ? <ApplicationForm /> : <IframeEmbed src={GOOGLE_FORM_URL} title="Parking Radio Appliquer" />
}
