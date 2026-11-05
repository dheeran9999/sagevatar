/**
 * Well-known franchise names. Library assets mentioning these must be recorded as LICENSED with
 * licence details, AI prompts naming them are refused, and searches for them explain that
 * exact artwork needs usage rights and offer original alternatives.
 */
export const PROTECTED_TERMS =
  /\b(spider[-\s]?man|spider[-\s]?woman|batman|batgirl|iron[-\s]?man|superman|supergirl|wonder[-\s]?woman|avengers?|marvel|dc comics|captain america|hulk|thor|joker|harley quinn|deadpool|wolverine|x-men|black panther|flash|aquaman|naruto|goku|dragon ball|one piece|pikachu|pok[eé]mon|disney|mickey|minnie|elsa|frozen|star wars|darth vader|harry potter|mario|sonic)\b/i;

export const protectedTermIn = (text: string): string | null =>
  text.match(PROTECTED_TERMS)?.[0] ?? null;

/** Original, rights-free directions to suggest instead of a protected character. */
export const ORIGINAL_ALTERNATIVES: Record<string, string> = {
  spider: 'an original agile wall-climbing hero in a red and blue web-pattern-free suit',
  bat: 'an original night-time vigilante in a dark armoured suit with a flowing cape',
  iron: 'an original high-tech armoured hero with glowing chest reactor and metallic suit',
  super: 'an original caped flying hero with a unique emblem',
  wonder: 'an original warrior heroine with golden armour and a shield',
  default: 'an original superhero with a unique costume, emblem and colour scheme',
};

export function originalAlternative(term: string): string {
  const t = term.toLowerCase();
  const key = Object.keys(ORIGINAL_ALTERNATIVES).find((k) => k !== 'default' && t.startsWith(k));
  return ORIGINAL_ALTERNATIVES[key ?? 'default'];
}
