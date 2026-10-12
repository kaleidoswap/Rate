/** Supertonic 3 accepts Unicode. Preserve accents while removing markup and payment payloads. */
export function sanitizeForSupertonic(text: string): string {
  return text.normalize('NFC')
    .replace(/\b(?:lightning:)?ln(?:bc|tb|bcrt)[a-z0-9]{40,}\b/gi, 'Lightning invoice')
    .replace(/\blnurl[0-9a-z]{40,}\b/gi, 'Lightning payment link')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[`´ˋ′*_~#<>|[\]{}]/g, ' ')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[•·]/g, '. ')
    .replace(/[^\p{L}\p{M}\p{N}\p{P}\p{Zs}\t\r\n]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}
