// The one shape an intent takes, whoever extracted it (rules or a model).
// A model's output is only accepted through `validateIntent`, which drops
// anything outside the schema and any amount or recipient that the user's own
// words don't contain.

export const INTENT_KINDS = ['send', 'receive', 'swap', 'balance', 'spending'] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export const INTENT_NETWORKS = ['lightning', 'onchain', 'spark', 'arkade', 'liquid', 'rgb'] as const;
export type IntentNetwork = (typeof INTENT_NETWORKS)[number];

export const INTENT_PERIODS = ['today', 'week', 'month', 'year', 'all'] as const;
export type IntentPeriod = (typeof INTENT_PERIODS)[number];

export const FIAT_CODES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'] as const;
export const ASSET_CODES = ['BTC', 'USDT', 'XAUT', 'USDB'] as const;

export type AmountUnit = 'sats' | 'BTC' | 'fiat' | 'asset' | 'fraction';

export interface IntentAmount {
  value: number;
  unit: AmountUnit;
  /** Fiat code for `fiat`, ticker for `asset`. */
  currency?: string;
  /** No unit was given; sats were assumed. */
  assumed?: boolean;
}

export interface MindIntent {
  kind: IntentKind;
  amount?: IntentAmount;
  /** Contact name, Lightning address, invoice or address, as the user wrote it. */
  recipient?: string;
  /** What moves or arrives (BTC unless said otherwise); the asset sold in a swap. */
  asset?: string;
  /** The asset bought in a swap. */
  toAsset?: string;
  network?: IntentNetwork;
  period?: IntentPeriod;
  /** For questions about activity: money out or money in. */
  direction?: 'out' | 'in';
}

export interface IntentResult {
  intent: MindIntent;
  source: 'rules' | 'model';
  /** Rules found every field the action needs. */
  confident: boolean;
}

/** The schema described to a model, field by field. Kept as data so no prompt depends on one model. */
export const INTENT_JSON_SCHEMA = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: { enum: [...INTENT_KINDS] },
    amount: { type: ['number', 'null'], description: 'The number the user said, exactly as said' },
    unit: { enum: ['sats', 'BTC', ...FIAT_CODES, 'USDT', 'XAUT', 'USDB', 'fraction', null] },
    recipient: { type: ['string', 'null'], description: 'Who receives, exactly as the user wrote it' },
    asset: { enum: [...ASSET_CODES, null] },
    to_asset: { enum: [...ASSET_CODES, null] },
    network: { enum: [...INTENT_NETWORKS, null] },
    period: { enum: [...INTENT_PERIODS, null] },
    direction: { enum: ['out', 'in', null] },
  },
} as const;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : undefined);

/** A unit word in any accepted spelling → the canonical amount unit. */
export function normalizeUnit(raw: unknown): Pick<IntentAmount, 'unit' | 'currency'> | null {
  const u = lower(raw);
  if (!u) return null;
  if (/^(sat|sats|satoshi|satoshis)$/.test(u)) return { unit: 'sats' };
  if (/^(btc|bitcoin|bitcoins)$/.test(u)) return { unit: 'BTC' };
  if (/^(€|eur|euro|euros)$/.test(u)) return { unit: 'fiat', currency: 'EUR' };
  if (/^(\$|usd|dollar|dollars|dollaro|dollari)$/.test(u)) return { unit: 'fiat', currency: 'USD' };
  if (/^(£|gbp|pound|pounds|sterlina|sterline)$/.test(u)) return { unit: 'fiat', currency: 'GBP' };
  if (/^(chf|franc|francs|franco|franchi)$/.test(u)) return { unit: 'fiat', currency: 'CHF' };
  if (/^(¥|jpy|yen)$/.test(u)) return { unit: 'fiat', currency: 'JPY' };
  if (/^(cad)$/.test(u)) return { unit: 'fiat', currency: 'CAD' };
  if (/^(aud)$/.test(u)) return { unit: 'fiat', currency: 'AUD' };
  if (/^(usdt|tether|usdt0)$/.test(u)) return { unit: 'asset', currency: 'USDT' };
  if (/^(xaut|gold|oro)$/.test(u)) return { unit: 'asset', currency: 'XAUT' };
  if (/^usdb$/.test(u)) return { unit: 'asset', currency: 'USDB' };
  if (u === 'fraction') return { unit: 'fraction' };
  return null;
}

export function normalizeAsset(raw: unknown): string | undefined {
  const n = normalizeUnit(raw);
  if (!n) return undefined;
  if (n.unit === 'sats' || n.unit === 'BTC') return 'BTC';
  if (n.unit === 'asset') return n.currency;
  return undefined;
}

const MAX_RECIPIENT = 120;
const cleanRecipient = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/[.,!?;:]+$/, '');
  if (!s || s.length > MAX_RECIPIENT || /[\n\r{}<>]/.test(s)) return undefined;
  return s;
};

/** Every number written in the text, so a model's amount can be checked against the user's words. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)*)\s*(k|m|mila|mln)?\b/gi)) {
    const base = parseLooseNumber(m[1]!);
    if (base == null) continue;
    const mult = !m[2] ? 1 : /^(k|mila)$/i.test(m[2]) ? 1_000 : 1_000_000;
    out.push(base, base * mult);
  }
  return out;
}

/** "5,000" → 5000 · "0,5" → 0.5 · "1.000.000" → 1000000 · "2.5" → 2.5 */
export function parseLooseNumber(raw: string): number | null {
  let s = raw.trim();
  if (!/^\d+(?:[.,]\d+)*$/.test(s)) return null;
  const groups = s.split(/[.,]/);
  const seps = s.match(/[.,]/g) ?? [];
  if (seps.length === 0) return Number(s);
  const allThousands = groups.slice(1).every((g) => g.length === 3);
  if (seps.length > 1) {
    const last = seps[seps.length - 1];
    if (new Set(seps).size === 1) return allThousands ? Number(groups.join('')) : null;
    const intPart = s.slice(0, s.lastIndexOf(last)).replace(/[.,]/g, '');
    return Number(`${intPart}.${groups[groups.length - 1]}`);
  }
  if (allThousands && groups[0] !== '0') return Number(groups.join(''));
  s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const FRACTION_WORDS = /\b(half|all|everything|quarter|metà|meta|mezzo|tutto|tutti|quarto)\b|\d+\s*%/i;

/**
 * Validate an untrusted intent object (a model's JSON). Returns null when the
 * kind is missing or unknown; drops any other field that is malformed or not
 * grounded in `userText`.
 */
export function validateIntent(raw: unknown, userText: string): MindIntent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kind = lower(o.kind);
  if (!isOneOf(INTENT_KINDS, kind)) return null;
  const intent: MindIntent = { kind };

  const amountValue = typeof o.amount === 'number' ? o.amount : typeof o.amount === 'string' ? parseLooseNumber(o.amount) : null;
  const unit = normalizeUnit(o.unit ?? o.currency);
  if (amountValue != null && Number.isFinite(amountValue) && amountValue > 0) {
    if (unit?.unit === 'fraction') {
      if (amountValue <= 1 && FRACTION_WORDS.test(userText)) intent.amount = { value: amountValue, unit: 'fraction' };
    } else if (numbersIn(userText).some((n) => Math.abs(n - amountValue) < 1e-9)) {
      intent.amount = unit ? { value: amountValue, ...unit } : { value: amountValue, unit: 'sats', assumed: true };
    }
  }

  const recipient = cleanRecipient(o.recipient);
  if (recipient && userText.toLowerCase().includes(recipient.toLowerCase())) intent.recipient = recipient;

  const asset = normalizeAsset(o.asset);
  if (asset) intent.asset = asset;
  const toAsset = normalizeAsset(o.to_asset ?? o.toAsset);
  if (toAsset) intent.toAsset = toAsset;
  const network = lower(o.network);
  if (isOneOf(INTENT_NETWORKS, network)) intent.network = network;
  const period = lower(o.period);
  if (isOneOf(INTENT_PERIODS, period)) intent.period = period;
  const direction = lower(o.direction);
  if (direction === 'out' || direction === 'in') intent.direction = direction;
  if (intent.kind === 'swap' && intent.asset && intent.asset === intent.toAsset) delete intent.toAsset;
  return intent;
}

/** The first JSON object in a model reply (models wrap it in prose or code fences). */
export function extractJsonObject(text: string): unknown {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}
