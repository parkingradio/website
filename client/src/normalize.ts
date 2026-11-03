// Text as it's compared wherever what's typed only has to match, e.g. in a combobox or a list's search: whatever its
// case and accents, with hyphens, apostrophes and dots the same as spaces, and ligatures the same as their letters,
// e.g. "etats unis" with "États-Unis", "cote d ivoire" with "Côte d’Ivoire", or "soeurs" with "Sœurs".
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[-'’.\s]+/g, ' ')
    .trim()
}
