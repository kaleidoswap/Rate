// Deterministic intent parsing: the common phrasings in English and Italian,
// with no model. Runs first and alone when the model is off, still loading or
// not downloaded. Falls back to the shared Funnel's recipe extractors for
// English phrasings these rules don't cover.

import { extractPayment, extractReceive, extractSwap, WALLET_FAST_INTENTS } from '@kaleidorg/mind';
import { numberWordsToDigits } from '../../utils/numberWords';
import {
  normalizeAsset,
  normalizeUnit,
  parseLooseNumber,
  type IntentAmount,
  type IntentNetwork,
  type IntentPeriod,
  type IntentResult,
  type MindIntent,
} from './schema';

const IT_NUMBERS: Record<string, number> = {
  uno: 1, una: 1, un: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9,
  dieci: 10, venti: 20, trenta: 30, quaranta: 40, cinquanta: 50, cento: 100, mille: 1000,
};

/** Number words (English and the common Italian ones) → digits, spacing normalized. */
export function normalizeIntentText(text: string): string {
  let t = numberWordsToDigits(String(text ?? '')).replace(/\s+/g, ' ').trim();
  t = t.replace(/\b(uno|una|un|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|venti|trenta|quaranta|cinquanta|cento|mille)\b(?=\s*(€|\$|£|euro|eur|dollar|dollari|sats?|satoshi|btc|bitcoin|usdt|mila|k\b))/gi,
    (w) => String(IT_NUMBERS[w.toLowerCase()]));
  return t;
}

const UNIT_WORD = '(sats?|satoshis?|btc|bitcoins?|eur|euros?|usd|dollars?|dollar[io]|gbp|pounds?|sterlin[ae]|chf|franchi|jpy|yen|cad|aud|usdt0?|tether|xaut|usdb|€|\\$|£|¥)';
const NUM = '(\\d+(?:[.,]\\d+)*)';
const MULT = '(k|m|mila|mln|milioni?)?';

const AMOUNT_AFTER = new RegExp(`${NUM}\\s*${MULT}\\s*${UNIT_WORD}?(?![\\w])`, 'i');
const AMOUNT_BEFORE = new RegExp(`(€|\\$|£|¥)\\s*${NUM}\\s*${MULT}(?![\\w])`, 'i');

const SEND = /\b(send|pay|transfer|give|tip|zap|invia|inviare|manda|mandare|paga|pagare|trasferisci|dai|regala|bonifica)\b/i;
const RECEIVE = /\b(receive|request|invoice|get paid|deposit|ricevi|ricevere|richiedi|richiedere|fattura|incassa|incassare|deposita)\b/i;
const SWAP = /\b(swap|convert|exchange|buy|sell|scambia|scambiare|converti|convertire|cambia|cambiare|compra|comprare|acquista|vendi|vendere)\b/i;
const QUESTION = /\b(how much|how many|what did|quanto|quanti|quante)\b|\?$/i;
const SPEND_Q = /\b(spen[dt]|spending|paid|pay out|spes[aeio]|speso|pagato|uscit[ae])\b/i;
const RECEIVED_Q = /\b(receive|received|got|earned|came in|ricevut[oaie]|incassat[oaie]|entrat[ae])\b/i;
const BALANCE_Q = /\b(balance|funds|how much (do i|have i|i have)|what do i have|saldo|quanto ho|cosa ho|fondi)\b/i;

const FRACTIONS: [RegExp, number][] = [
  [/(?:^|[^A-Za-zÀ-ÖØ-öø-ÿ])(half|metà|meta|mezzo)(?![A-Za-zÀ-ÖØ-öø-ÿ])/i, 0.5],
  [/(?:^|[^A-Za-zÀ-ÖØ-öø-ÿ])(quarter|quarto)(?![A-Za-zÀ-ÖØ-öø-ÿ])/i, 0.25],
  [/(?:^|[^A-Za-zÀ-ÖØ-öø-ÿ])(all|everything|tutto|tutti|tutta)(?![A-Za-zÀ-ÖØ-öø-ÿ])/i, 1],
];

const LAYERS: [RegExp, IntentNetwork][] = [
  [/\b(lightning|ln|fulmine)\b/i, 'lightning'],
  [/\b(on[- ]?chain|onchain|l1|bitcoin address|indirizzo bitcoin)\b/i, 'onchain'],
  [/\bspark\b/i, 'spark'],
  [/\b(arkade|ark)\b/i, 'arkade'],
  [/\bliquid\b/i, 'liquid'],
  [/\brgb\b/i, 'rgb'],
];

const PERIODS: [RegExp, IntentPeriod][] = [
  [/\b(today|oggi)\b/i, 'today'],
  [/\b(this week|last week|week|settimana|7 days|7 giorni)\b/i, 'week'],
  [/\b(this month|last month|month|mese|30 days|30 giorni)\b/i, 'month'],
  [/\b(this year|year|anno)\b/i, 'year'],
  [/\b(ever|all time|in total|in totale|sempre)\b/i, 'all'],
];

const DESTINATION = /\b(ln(?:bc|tb|bcrt)[0-9a-z]{20,}|lno1[0-9a-z]+|(?:bc1|tb1|bcrt1)[0-9a-z]{20,}|(?:spark|sp)(?:t|rt|s|l)?1[0-9a-z]{20,}|t?ark1[0-9a-z]{20,}|rgb:[^\s]+|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i;

const RECIPIENT_STOP = new Set([
  'on', 'via', 'with', 'using', 'for', 'from', 'in', 'by', 'now', 'please', 'today', 'tomorrow',
  'su', 'con', 'per', 'da', 'tramite', 'adesso', 'ora', 'subito', 'grazie', 'oggi', 'domani',
  'and', 'e', 'to', 'lightning', 'onchain', 'spark', 'arkade',
]);
const PRONOUNS = new Set(['me', 'my', 'myself', 'mine', 'it', 'him', 'her', 'them', 'us', 'mio', 'mia', 'miei', 'mie', 'lui', 'lei', 'loro', 'noi']);
const ARTICLES = new Set(['the', 'a', 'an', 'il', 'lo', 'la', 'i', 'gli', 'le']);

function readAmount(t: string): IntentAmount | undefined {
  const pct = t.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (pct) {
    const v = parseLooseNumber(pct[1]!);
    if (v != null && v > 0 && v <= 100) return { value: v / 100, unit: 'fraction' };
  }
  const before = t.match(AMOUNT_BEFORE);
  const after = t.match(AMOUNT_AFTER);
  let raw: string | undefined;
  let mult: string | undefined;
  let unitWord: string | undefined;
  if (before && (!after || (before.index ?? 0) <= (after.index ?? 0))) {
    [, unitWord, raw, mult] = before;
  } else if (after) {
    [, raw, mult, unitWord] = after;
  }
  if (raw) {
    let value = parseLooseNumber(raw);
    if (value == null || value <= 0) return undefined;
    if (mult) value *= /^(k|mila)$/i.test(mult) ? 1_000 : 1_000_000;
    const unit = normalizeUnit(unitWord);
    return unit ? { value, ...unit } : { value, unit: 'sats', assumed: true };
  }
  for (const [re, value] of FRACTIONS) if (re.test(t)) return { value, unit: 'fraction' };
  return undefined;
}

function readNetwork(t: string): IntentNetwork | undefined {
  for (const [re, n] of LAYERS) if (re.test(t)) return n;
  return undefined;
}

function readPeriod(t: string): IntentPeriod | undefined {
  for (const [re, p] of PERIODS) if (re.test(t)) return p;
  return undefined;
}

/** "to Mario Rossi on lightning" → "Mario Rossi"; "a Mario" (Italian) → "Mario". */
function readRecipient(t: string): string | undefined {
  const dest = t.match(DESTINATION)?.[1];
  if (dest) return dest;
  const after = t.match(/\b(?:to|a|ad|per)\s+(.+)$/i)?.[1];
  const name = after ? takeName(after) : undefined;
  if (name) return name;
  // "pay Mario 10€" / "paga Mario 10€": the word right after the verb.
  const direct = t.match(new RegExp(`${SEND.source}\\s+(.+)$`, 'i'))?.[2];
  return direct ? takeName(direct) : undefined;
}

function takeName(rest: string): string | undefined {
  const words: string[] = [];
  for (const raw of rest.split(/\s+/)) {
    const w = raw.replace(/[.,!?;:]+$/, '');
    if (!w || RECIPIENT_STOP.has(w.toLowerCase())) break;
    if (/^[\d€$£¥]/.test(w) || normalizeUnit(w)) break;
    words.push(w);
    if (/[.,!?;:]$/.test(raw) || words.length === 3) break;
  }
  while (words.length && ARTICLES.has(words[0].toLowerCase())) words.shift();
  if (!words.length || PRONOUNS.has(words[0].toLowerCase())) return undefined;
  return words.join(' ');
}

/** Tickers named in order of appearance ("BTC to USDT" → ['BTC', 'USDT']). */
function tickersIn(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(/\b(btc|bitcoins?|sats?|satoshis?|usdt0?|tether|xaut|gold|oro|usdb)\b/gi)) {
    const a = normalizeAsset(m[1]);
    if (a && out[out.length - 1] !== a) out.push(a);
  }
  return out;
}

function parseSwap(t: string, amount: IntentAmount | undefined): MindIntent {
  const tickers = tickersIn(t);
  const buy = /\b(buy|compra|comprare|acquista|get)\b/i.test(t);
  const sell = /\b(sell|vendi|vendere)\b/i.test(t);
  const intent: MindIntent = { kind: 'swap' };
  const into = t.match(/\b(?:to|into|for|in|per|→|->)\s+(?:some\s+)?(btc|bitcoins?|sats?|usdt0?|tether|xaut|gold|oro|usdb)\b/i);
  const target = normalizeAsset(into?.[1]);
  if (buy) {
    intent.toAsset = target ?? amountAsset(amount) ?? tickers[0];
    intent.asset = tickers.find((x) => x !== intent.toAsset) ?? (intent.toAsset === 'BTC' ? 'USDT' : 'BTC');
  } else {
    intent.asset = amountAsset(amount) ?? tickers.find((x) => x !== target) ?? (sell ? tickers[0] : undefined) ?? 'BTC';
    intent.toAsset = target ?? tickers.find((x) => x !== intent.asset) ?? (intent.asset === 'BTC' ? 'USDT' : 'BTC');
  }
  if (amount) intent.amount = amount;
  return intent;
}

function amountAsset(a: IntentAmount | undefined): string | undefined {
  if (!a) return undefined;
  if (a.unit === 'sats' || a.unit === 'BTC') return a.assumed ? undefined : 'BTC';
  return a.unit === 'asset' ? a.currency : undefined;
}

/** Rules first; returns null when the text isn't one of the supported intents. */
export function parseIntentRules(input: string): IntentResult | null {
  const t = normalizeIntentText(input);
  if (!t) return null;
  const amount = readAmount(t);
  const network = readNetwork(t);
  const isQuestion = QUESTION.test(t);

  if (isQuestion && (SPEND_Q.test(t) || RECEIVED_Q.test(t))) {
    const direction = RECEIVED_Q.test(t) && !SPEND_Q.test(t) ? 'in' : 'out';
    return { intent: { kind: 'spending', direction, period: readPeriod(t) ?? 'week' }, source: 'rules', confident: true };
  }
  if (BALANCE_Q.test(t) && !SEND.test(t) && !SWAP.test(t)) {
    const asset = tickersIn(t)[0];
    return { intent: { kind: 'balance', ...(asset ? { asset } : {}) }, source: 'rules', confident: true };
  }
  if (SWAP.test(t) && !SEND.test(t.replace(/\bswap\b/gi, ''))) {
    const intent = parseSwap(t, amount);
    if (network) intent.network = network;
    return { intent, source: 'rules', confident: !!intent.amount && !!intent.asset && !!intent.toAsset };
  }
  if (RECEIVE.test(t) && !SEND.test(t)) {
    const intent: MindIntent = { kind: 'receive' };
    if (amount && amount.unit !== 'fraction') intent.amount = amount;
    const asset = amountAsset(amount) ?? tickersIn(t).find((a) => a !== 'BTC');
    intent.asset = asset ?? 'BTC';
    if (network) intent.network = network;
    return { intent, source: 'rules', confident: true };
  }
  if (SEND.test(t)) {
    const intent: MindIntent = { kind: 'send' };
    if (amount) intent.amount = amount;
    const recipient = readRecipient(t);
    if (recipient) intent.recipient = recipient;
    intent.asset = amountAsset(amount) ?? 'BTC';
    if (network) intent.network = network;
    return { intent, source: 'rules', confident: !!intent.amount && !!intent.recipient };
  }
  return fromFunnelExtractors(t);
}

/** The shared recipe extractors (English) as a last deterministic pass. */
function fromFunnelExtractors(t: string): IntentResult | null {
  const swap = extractSwap(t) as { from_asset?: string; to_asset?: string; amount?: number } | null;
  if (swap?.from_asset && swap.to_asset) {
    const intent: MindIntent = { kind: 'swap', asset: swap.from_asset, toAsset: swap.to_asset };
    if (typeof swap.amount === 'number' && swap.amount > 0) {
      const unit = normalizeUnit(swap.from_asset);
      intent.amount = { value: swap.amount, ...(unit ?? { unit: 'sats' as const }) };
    }
    return { intent, source: 'rules', confident: false };
  }
  const recv = extractReceive(t) as { amount?: number; currency?: string; layer?: string } | null;
  if (recv) {
    const intent: MindIntent = { kind: 'receive', asset: normalizeAsset(recv.currency) ?? 'BTC' };
    const unit = normalizeUnit(recv.currency);
    if (typeof recv.amount === 'number' && recv.amount > 0) intent.amount = { value: recv.amount, ...(unit ?? { unit: 'sats' as const }) };
    return { intent, source: 'rules', confident: false };
  }
  const pay = extractPayment(t) as { recipient?: string; amount?: number; currency?: string } | null;
  if (pay?.recipient) {
    const intent: MindIntent = { kind: 'send', recipient: pay.recipient, asset: 'BTC' };
    const unit = normalizeUnit(pay.currency);
    if (typeof pay.amount === 'number' && pay.amount > 0) intent.amount = unit ? { value: pay.amount, ...unit } : { value: pay.amount, unit: 'sats', assumed: true };
    return { intent, source: 'rules', confident: false };
  }
  if (WALLET_FAST_INTENTS.find((i) => i.name === 'balance')?.match(t)) {
    return { intent: { kind: 'balance' }, source: 'rules', confident: true };
  }
  return null;
}
