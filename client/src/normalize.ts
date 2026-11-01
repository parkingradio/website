// For matching what's typed, e.g. in a combobox (see combobox.tsx), whatever its case, accents, hyphens, apostrophes and
// dots, e.g. "etats unis" with "États-Unis", or "cote d ivoire" with "Côte d’Ivoire".
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[-'’.\s]+/g, ' ')
    .trim()
}
