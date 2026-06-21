// utils/numberWords.ts
//
// Convert spoken/typed number WORDS into digits before a message reaches the
// agent, so the deterministic payment recipe (and the small LLM) can extract an
// amount from phrasings like "send Walter one satoshi" or "pay Bob twenty-one
// sats". Whisper transcribes spoken numbers as words, so this matters most in
// voice mode.

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };
const FILLER = new Set(['a', 'an', 'and']);

const isNumberWord = (w: string) => w in SMALL || w in SCALE || FILLER.has(w);
const hasCore = (words: string[]) => words.some((w) => w in SMALL || w in SCALE);

/** Parse a run of number words ("twenty one", "a hundred and five") → a number. */
function parseRun(words: string[]): number {
  let total = 0;
  let current = 0;
  for (const w of words) {
    if (FILLER.has(w)) continue;
    if (w in SMALL) current += SMALL[w];
    else if (w === 'hundred') current = (current || 1) * 100;
    else if (w in SCALE) { total += (current || 1) * SCALE[w]; current = 0; }
  }
  return total + current;
}

/**
 * Replace each maximal run of number words with its numeric value. Runs must
 * contain at least one real number word (so a stray "a"/"and" is left alone),
 * and word boundaries prevent matching inside other words ("often", "someone").
 */
export function numberWordsToDigits(text: string): string {
  if (!text) return text;
  // Tokenise into words (allowing hyphenated "twenty-one") and non-words, so we
  // can rebuild the string with only number-word runs replaced.
  const parts = text.split(/([A-Za-z]+(?:-[A-Za-z]+)*)/);
  const subOf = (idx: number) => parts[idx].toLowerCase().split('-');
  // parts alternates [nonword, word, nonword, word, ...]; word indices are odd.
  let i = 1;
  while (i < parts.length) {
    if (!subOf(i).every(isNumberWord)) { i += 2; continue; }
    // Greedily collect the run's word-token indices (spaces in between only).
    const tokenIdxs = [i];
    let j = i + 2;
    while (j < parts.length && /^\s+$/.test(parts[j - 1]) && subOf(j).every(isNumberWord)) {
      tokenIdxs.push(j);
      j += 2;
    }
    // Trim trailing filler tokens BY INDEX so "and"/"a" at the end (and their
    // separators) are left in place rather than swallowed into the number.
    while (tokenIdxs.length && subOf(tokenIdxs[tokenIdxs.length - 1]).every((w) => FILLER.has(w))) {
      tokenIdxs.pop();
    }
    const runWords = tokenIdxs.flatMap(subOf);
    if (tokenIdxs.length === 0 || !hasCore(runWords)) { i += 2; continue; }
    const endIdx = tokenIdxs[tokenIdxs.length - 1];
    parts.splice(i, endIdx - i + 1, String(parseRun(runWords)));
    i += 2;
  }
  return parts.join('');
}
