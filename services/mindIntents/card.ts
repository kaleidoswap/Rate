// Intent → action card. Every number on the card (sats, fiat, fees, what a swap
// returns) comes from the wallet: its price feed, balances, Send quotes and swap
// quotes. The intent only says what the user asked for.

import type { IntentAmount, MindIntent } from './schema';

export interface CardContact {
  name: string;
  lightning_address?: string;
  pubkey?: string;
}

export interface SendQuoteView {
  feeSat?: number;
  totalSat?: number;
  /** Which account and rail pays, e.g. "Spark · Lightning". */
  route?: string;
}

export interface SwapQuoteView {
  receiveAmount: number;
  receiveUnit: string;
  fee?: number;
  feeUnit?: string;
  venue?: string;
}

export interface CardDeps {
  /** The user's display currency. */
  fiat: string;
  /** BTC price in `currency`, or 0/undefined when unknown. */
  btcPrice(currency: string): number | undefined;
  /** Spendable balance: sats for BTC, display units for a token. */
  balance(asset: string): number | undefined;
  findContacts(name: string): CardContact[];
  contactDestination(contact: CardContact): Promise<string | undefined>;
  quoteSend(destination: string, amountSat: number): Promise<SendQuoteView>;
  quoteSwap(from: string, to: string, fromAmount: number): Promise<SwapQuoteView>;
}

export type ReviewTarget =
  | { screen: 'Send'; params: { prefilledAddress?: string; contactName?: string; prefilledAmountSat?: number } }
  | { screen: 'Receive'; params: { prefilledAmountSat?: number; prefilledNetwork?: 'lightning' | 'onchain'; prefilledAssetTicker?: string } }
  | { screen: 'Swap'; params: { fromAsset: string; toAsset: string; fromAmountSat?: number; fromAmountUnits?: number } };

export interface ActionCard {
  kind: 'send' | 'receive' | 'swap';
  title: string;
  asset: string;
  /** BTC amount in sats (send/receive, or the BTC leg sold in a swap). */
  amountSat?: number;
  /** Token amount in display units, when the asset isn't BTC. */
  amountUnits?: number;
  /** The amount in fiat, from the wallet's price (or as typed). */
  fiat?: { value: number; currency: string; typed: boolean };
  recipient?: { name?: string; destination?: string };
  route?: string;
  fee?: { status: 'quoted' | 'unavailable' | 'none'; sat?: number; units?: number; unit?: string; note?: string };
  /** What a swap returns, from the venue's quote. */
  receive?: { amount: number; unit: string; venue?: string };
  warnings: string[];
  review: ReviewTarget;
}

const SATS = 1e8;
const USD_STABLE = new Set(['USDT', 'USDB', 'USDC']);
const DESTINATION = /^(ln(bc|tb|bcrt)|lno1|bc1|tb1|bcrt1|spark|sp1|t?ark1|rgb:)|^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export const isDestination = (s: string) => DESTINATION.test(s.trim());

const NETWORK_LABEL: Record<string, string> = {
  lightning: 'Lightning', onchain: 'On-chain', spark: 'Spark', arkade: 'Arkade', liquid: 'Liquid', rgb: 'RGB',
};

/** Sats for a BTC-denominated amount, using the wallet's price for fiat. */
export function amountToSats(amount: IntentAmount | undefined, deps: Pick<CardDeps, 'btcPrice' | 'balance'>):
  { sats?: number; fiatTyped?: { value: number; currency: string }; warning?: string } {
  if (!amount) return {};
  switch (amount.unit) {
    case 'sats': return { sats: Math.round(amount.value) };
    case 'BTC': return { sats: Math.round(amount.value * SATS) };
    case 'fiat': {
      const currency = amount.currency ?? 'USD';
      const price = deps.btcPrice(currency);
      if (!price) return { fiatTyped: { value: amount.value, currency }, warning: `No ${currency} price right now, so the amount is left for you to enter.` };
      return { sats: Math.round((amount.value / price) * SATS), fiatTyped: { value: amount.value, currency } };
    }
    case 'fraction': {
      const bal = deps.balance('BTC');
      if (bal == null) return { warning: 'Your balance is not known yet.' };
      return { sats: Math.floor(bal * amount.value) };
    }
    default: return {};
  }
}

function fiatOf(sats: number | undefined, deps: CardDeps, typed?: { value: number; currency: string }): ActionCard['fiat'] {
  if (typed) return { ...typed, typed: true };
  if (sats == null) return undefined;
  const price = deps.btcPrice(deps.fiat);
  return price ? { value: (sats / SATS) * price, currency: deps.fiat, typed: false } : undefined;
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

async function sendCard(intent: MindIntent, deps: CardDeps): Promise<ActionCard> {
  const warnings: string[] = [];
  const asset = intent.asset ?? 'BTC';
  const card: ActionCard = { kind: 'send', title: 'Send', asset, warnings, review: { screen: 'Send', params: {} } };

  if (asset !== 'BTC') {
    warnings.push(`To send ${asset}, ask the recipient for an RGB invoice and paste it in Send.`);
    if (intent.amount?.unit === 'asset') card.amountUnits = intent.amount.value;
  } else {
    const { sats, fiatTyped, warning } = amountToSats(intent.amount, deps);
    if (warning) warnings.push(warning);
    if (intent.amount?.assumed) warnings.push('No unit given, so this reads as sats.');
    if (intent.amount?.unit === 'fraction' && intent.amount.value >= 1) warnings.push('Sending everything leaves nothing for the fee. Send shows the most you can send.');
    if (sats != null && sats > 0) card.amountSat = sats;
    card.fiat = fiatOf(card.amountSat, deps, fiatTyped);
    const bal = deps.balance('BTC');
    if (card.amountSat != null && bal != null && card.amountSat > bal) warnings.push('That is more than your balance.');
  }

  const who = intent.recipient?.trim();
  let destination: string | undefined;
  let name: string | undefined;
  if (!who) {
    warnings.push('Who should receive it? Pick a contact or paste an address in Send.');
  } else if (isDestination(who)) {
    destination = who;
  } else {
    const matches = deps.findContacts(who);
    if (matches.length === 1) {
      name = matches[0].name;
      destination = await deps.contactDestination(matches[0]).catch(() => undefined);
      if (!destination) warnings.push(`${name} has no Lightning address saved.`);
    } else if (matches.length > 1) {
      warnings.push(`Several contacts match “${who}”: ${matches.map((c) => c.name).join(', ')}.`);
    } else {
      warnings.push(`No contact named “${who}”.`);
    }
  }
  card.recipient = who ? { name: name ?? (destination ? undefined : who), destination } : undefined;
  const label = name ?? (destination ? shorten(destination) : who);
  card.title = label ? `Send to ${label}` : 'Send';
  if (intent.network) card.route = NETWORK_LABEL[intent.network];

  if (asset === 'BTC' && destination && card.amountSat) {
    try {
      const q = await deps.quoteSend(destination, card.amountSat);
      card.fee = q.feeSat != null ? { status: 'quoted', sat: q.feeSat } : { status: 'unavailable', note: 'No fee quote yet.' };
      if (q.route) card.route = q.route;
    } catch (e) {
      card.fee = { status: 'unavailable', note: errorText(e, 'Could not get a fee quote.') };
    }
  }
  card.review = {
    screen: 'Send',
    params: {
      ...(destination ? { prefilledAddress: destination } : {}),
      ...(name ? { contactName: name } : {}),
      ...(card.amountSat ? { prefilledAmountSat: card.amountSat } : {}),
    },
  };
  return card;
}

function receiveCard(intent: MindIntent, deps: CardDeps): ActionCard {
  const warnings: string[] = [];
  const asset = intent.asset ?? 'BTC';
  const card: ActionCard = { kind: 'receive', title: `Receive ${asset === 'BTC' ? 'bitcoin' : asset}`, asset, warnings, review: { screen: 'Receive', params: {} } };
  if (asset === 'BTC') {
    const { sats, fiatTyped, warning } = amountToSats(intent.amount?.unit === 'fraction' ? undefined : intent.amount, deps);
    if (warning) warnings.push(warning);
    if (sats) card.amountSat = sats;
    card.fiat = fiatOf(card.amountSat, deps, fiatTyped);
  } else if (intent.amount?.unit === 'asset') {
    card.amountUnits = intent.amount.value;
  }
  const network = intent.network === 'lightning' || intent.network === 'onchain' ? intent.network : undefined;
  card.route = network ? NETWORK_LABEL[network] : asset === 'BTC' ? 'Any network (one QR code)' : 'RGB';
  card.fee = { status: 'none', note: 'Free to request.' };
  card.review = {
    screen: 'Receive',
    params: {
      ...(card.amountSat ? { prefilledAmountSat: card.amountSat } : {}),
      ...(network ? { prefilledNetwork: network } : {}),
      ...(asset !== 'BTC' ? { prefilledAssetTicker: asset } : {}),
    },
  };
  return card;
}

async function swapCard(intent: MindIntent, deps: CardDeps): Promise<ActionCard> {
  const warnings: string[] = [];
  const from = intent.asset ?? 'BTC';
  const to = intent.toAsset ?? (from === 'BTC' ? 'USDT' : 'BTC');
  const card: ActionCard = { kind: 'swap', title: `Swap ${from} to ${to}`, asset: from, warnings, review: { screen: 'Swap', params: { fromAsset: from, toAsset: to } } };
  const a = intent.amount;
  let fromAmount: number | undefined;

  if (a?.unit === 'fraction') {
    const bal = deps.balance(from);
    if (bal == null) warnings.push(`Your ${from} balance is not known yet.`);
    else fromAmount = from === 'BTC' ? Math.floor(bal * a.value) : Math.floor(bal * a.value * 1e6) / 1e6;
  } else if (a && from === 'BTC' && (a.unit === 'sats' || a.unit === 'BTC' || a.unit === 'fiat')) {
    const r = amountToSats(a, deps);
    if (r.warning) warnings.push(r.warning);
    fromAmount = r.sats;
    if (r.fiatTyped) card.fiat = { ...r.fiatTyped, typed: true };
  } else if (a?.unit === 'asset' && a.currency === from) {
    fromAmount = a.value;
  } else if (a?.unit === 'fiat' && a.currency === 'USD' && USD_STABLE.has(from)) {
    fromAmount = a.value;
  } else if (a?.unit === 'asset' && a.currency === to && from === 'BTC' && USD_STABLE.has(to)) {
    const price = deps.btcPrice('USD');
    if (price) {
      fromAmount = Math.round((a.value / price) * SATS);
      warnings.push(`About ${a.value} ${to} at today’s BTC price; the quote shows the exact amount.`);
    } else {
      warnings.push(`Enter how much ${from} to swap.`);
    }
  } else if (a) {
    warnings.push(`Enter how much ${from} to swap.`);
  }

  if (fromAmount != null && fromAmount > 0) {
    if (from === 'BTC') card.amountSat = fromAmount;
    else card.amountUnits = fromAmount;
    if (!card.fiat && from === 'BTC') card.fiat = fiatOf(fromAmount, deps);
    const bal = deps.balance(from);
    if (bal != null && fromAmount > bal) warnings.push(`That is more than your ${from} balance.`);
    try {
      const q = await deps.quoteSwap(from, to, fromAmount);
      card.receive = { amount: q.receiveAmount, unit: q.receiveUnit, venue: q.venue };
      card.route = q.venue;
      card.fee = q.fee != null ? { status: 'quoted', ...(q.feeUnit === 'sats' ? { sat: q.fee } : { units: q.fee, unit: q.feeUnit }) } : { status: 'unavailable', note: 'The provider did not state a fee.' };
    } catch (e) {
      card.fee = { status: 'unavailable', note: errorText(e, 'Could not get a swap quote.') };
    }
  }
  card.review = {
    screen: 'Swap',
    params: {
      fromAsset: from,
      toAsset: to,
      ...(card.amountSat ? { fromAmountSat: card.amountSat } : {}),
      ...(card.amountUnits ? { fromAmountUnits: card.amountUnits } : {}),
    },
  };
  return card;
}

const shorten = (s: string) => (s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);

export async function buildActionCard(intent: MindIntent, deps: CardDeps): Promise<ActionCard | null> {
  switch (intent.kind) {
    case 'send': return sendCard(intent, deps);
    case 'receive': return receiveCard(intent, deps);
    case 'swap': return swapCard(intent, deps);
    default: return null;
  }
}
