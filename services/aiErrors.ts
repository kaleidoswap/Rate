// What the chat says when a turn fails: wallet errors are already written for the
// user and pass through; known engine failures become a next step; anything that
// looks technical is replaced by a calm sentence instead of a raw error string.

const FALLBACK = "I couldn't do that just now. Please try again.";

const KNOWN: Array<[RegExp, string]> = [
  [
    /context window|prompt tokens|exceeds the|context length|too long/i,
    'This conversation got too long for the on-device model. Clear the chat (🗑️ in the header) to start fresh, then try again.',
  ],
  [
    /network request failed|failed to fetch|timeout|timed out|abort/i,
    'I could not reach the network. Check your connection and try again.',
  ],
  [
    /model (is )?not (ready|loaded)|not loaded|out of memory|\boom\b|worker (crashed|exited)/i,
    'The on-device model is not ready. Close other apps and try again, or reload it from KaleidoMind settings.',
  ],
];

const TECHNICAL = /\b(TypeError|ReferenceError|SyntaxError|undefined|NaN|ERR_[A-Z_]+|0x[0-9a-f]{4,})\b|\bat \S+:\d+|[{}[\]]|\n/;

export function chatErrorMessage(error: unknown): string {
  const raw = error instanceof Error && error.message ? error.message.trim() : '';
  if (!raw) return FALLBACK;
  const known = KNOWN.find(([re]) => re.test(raw));
  if (known) return known[1];
  const readable = /^[A-Z"'“].*[.!?…"”]$/.test(raw) && raw.length <= 240 && !TECHNICAL.test(raw);
  return readable ? raw : FALLBACK;
}
