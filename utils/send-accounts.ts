/**
 * Send, seen by account: every way to pay grouped under the account it spends from,
 * so the user picks "Pay from Spark" rather than a route. Pure; the screen passes in
 * the offers and the balances it already has.
 */
import type { PaymentOffer } from '../services/kaleidoPay';
import { quoteSpend } from '../services/kaleidoPay';

export type PayAccountId = 'SPARK' | 'ARKADE' | 'BARK' | 'RGB';

export const PAY_ACCOUNT_NAME: Record<PayAccountId, string> = {
  SPARK: 'Spark', ARKADE: 'Arkade', BARK: 'Bark', RGB: 'RGB Lightning node',
};

/** The account an offer spends from, read from its source id (`spark-ln`, `arkade-onchain`, `bark`, `rgb-ln`, …). */
export function offerAccount(offer: Pick<PaymentOffer, 'route'>): PayAccountId | null {
  const head = offer.route.sourceId.toLowerCase().split('-')[0];
  return ({ spark: 'SPARK', arkade: 'ARKADE', bark: 'BARK', rgb: 'RGB' } as const)[head as 'spark'] ?? null;
}

const live = (o: PaymentOffer, now: number) => !!o.quote && !o.unavailable && o.quote.expiresAt * 1000 > now;
const totalOf = (o: PaymentOffer) => (o.quote ? quoteSpend(o.quote).total : Number.POSITIVE_INFINITY);

export interface AccountChoice {
  account: PayAccountId;
  /** Its offers, payable ones first and cheapest first. */
  offers: PaymentOffer[];
  /** The offer picking this account selects: its cheapest payable one. */
  best?: PaymentOffer;
  /** Why it can't pay right now, when nothing is payable. */
  reason?: string;
}

/**
 * Offers grouped by account, accounts that can pay first and cheapest first.
 * Bark only shows in Lite when it holds funds (so they can still be spent); offers
 * that can't be traced to an account are left out of the cards but stay in the sheet.
 */
export function groupOffersByAccount(
  offers: PaymentOffer[],
  opts: { advanced: boolean; balances?: Partial<Record<PayAccountId, number>>; now?: number },
): AccountChoice[] {
  const now = opts.now ?? Date.now();
  const byAccount = new Map<PayAccountId, PaymentOffer[]>();
  for (const offer of offers) {
    const account = offerAccount(offer);
    if (!account) continue;
    if (account === 'BARK' && !opts.advanced && !((opts.balances?.BARK ?? 0) > 0)) continue;
    byAccount.set(account, [...(byAccount.get(account) ?? []), offer]);
  }
  const choices: AccountChoice[] = [...byAccount.entries()].map(([account, list]) => {
    const sorted = [...list].sort((a, b) => Number(live(b, now)) - Number(live(a, now)) || totalOf(a) - totalOf(b));
    const best = sorted.find(o => live(o, now) && o.executable) ?? sorted.find(o => live(o, now));
    const reason = best ? undefined : sorted.find(o => o.unavailable)?.unavailable ?? 'No quote right now';
    return { account, offers: sorted, best, reason };
  });
  return choices.sort((a, b) => Number(!!b.best) - Number(!!a.best) || totalOf(a.best ?? a.offers[0]) - totalOf(b.best ?? b.offers[0]));
}

/** The rail a route ends on, for the path line ("Spark → Lightning → Coffee shop"). */
export function railOf(to: string): 'ln' | 'btc' | 'spark' | 'ark' | 'rgb' | string {
  return to.split(':')[0];
}
