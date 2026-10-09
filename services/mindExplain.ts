// "Explain" for one exact item: an activity entry, its fee, an RGB transfer or
// an error. The model gets the item's structured facts and must stay within
// them; without the model (or when its answer strays) a static explanation is
// used, so this works offline.

import type { ActivityItem } from './ActivityService';
import { LAYER_LABEL } from '../utils/activity-layers';
import { RGB_TRANSFER_STATUS_LABEL, rgbTransferStatusDetail } from '../utils/rgb-wallet';
import { describeSwapFailure } from '../utils/swap-errors';
import type { LocalTextModel } from './mindIntents/model';

export type ExplainSubject =
  | { type: 'activity'; item: ActivityItem }
  | { type: 'fee'; item: ActivityItem }
  | { type: 'rgb-transfer'; item: ActivityItem }
  | { type: 'error'; context: 'swap' | 'send' | 'receive' | 'general'; message: string; title?: string };

export interface Explanation { title: string; text: string; source: 'model' | 'template' }

const LIGHTNING = new Set(['LN', 'RGB-LN', 'Spark', 'Arkade', 'Bark', 'Bark Signet']);
const ONCHAIN = new Set(['L1', 'RGB-L1']);

const amountOf = (item: ActivityItem) => (item.rawSats != null ? `${item.rawSats.toLocaleString('en-US')} sats` : item.amount ? `${item.amount} ${item.assetTicker}` : 'an amount');

/** Only what the explanation needs; no ids, hashes or proofs. */
export function subjectFacts(s: ExplainSubject): Record<string, unknown> {
  if (s.type === 'error') return { kind: 'error', where: s.context, title: s.title, message: s.message.slice(0, 300) };
  const i = s.item;
  return {
    kind: s.type,
    direction: i.type,
    status: i.status,
    method: LAYER_LABEL[i.layer] ?? i.layer,
    asset: i.assetTicker,
    amount_sats: i.rawSats,
    amount: i.rawSats == null && i.amount ? i.amount : undefined,
    fee_sats: i.fee,
    account: i.account,
    network: i.network,
    rgb_step: i.rgbTransfer ? RGB_TRANSFER_STATUS_LABEL[i.rgbTransfer.status] : undefined,
    rgb_direction: i.rgbTransfer?.direction,
    cross_chain: i.crossChain ? `${i.crossChain.sourceAsset} on ${i.crossChain.sourceChain} to ${i.crossChain.destAsset} on ${i.crossChain.destChain}` : undefined,
  };
}

function activityTemplate(i: ActivityItem): string {
  const amount = amountOf(i);
  const method = LAYER_LABEL[i.layer] ?? i.layer;
  const out = i.type === 'send';
  if (i.type === 'swap') {
    if (i.status === 'failed') return 'This swap did not complete. Swaps happen in full or not at all, so your funds stayed where they were.';
    if (i.status === 'pending' || i.status === 'unknown') return 'This swap is still settling. A swap either completes on both sides or not at all; check back in a moment before trying again.';
    return 'This was a swap: you exchanged one asset for another in a single step. Both sides completed together, so neither party could take one side without the other.';
  }
  if (i.type === 'channel_open') return 'This opened a Lightning channel, money set aside on-chain so you can pay and get paid instantly over Lightning. It becomes usable after a few blocks confirm it.';
  if (i.type === 'channel_close') return 'This closed a Lightning channel. Your share goes back to your on-chain balance once the closing transaction confirms.';
  if (i.type === 'issuance') return `This created ${amount} as a new RGB asset in your wallet. RGB assets live on bitcoin but are tracked by your wallet, so keep its backup safe.`;
  if (i.status === 'failed') {
    return LIGHTNING.has(i.layer)
      ? `This ${method} payment of ${amount} failed, so it was not delivered. Any amount held for it returns to your balance automatically.`
      : `This ${method} transfer of ${amount} failed and was not completed. Check your balance before trying again.`;
  }
  if (i.status === 'unknown') return `The ${method} provider has not confirmed the result of this ${out ? 'payment' : 'transfer'} of ${amount} yet. It may still complete, so check its status before sending again.`;
  if (i.status === 'pending') {
    return ONCHAIN.has(i.layer)
      ? `This on-chain ${out ? 'payment' : 'deposit'} of ${amount} is waiting for a miner to put it in a block. That usually takes 10 to 60 minutes, depending on the fee paid and how busy the network is.`
      : `This ${method} ${out ? 'payment' : 'receive'} of ${amount} is still in progress. It usually settles within seconds to minutes.`;
  }
  if (LIGHTNING.has(i.layer)) {
    return `You ${out ? 'sent' : 'received'} ${amount} over ${method}. ${method} payments settle in seconds without waiting for blocks, and are final once done.`;
  }
  return `You ${out ? 'sent' : 'received'} ${amount} on-chain. It is recorded in a bitcoin block, which makes it final; more blocks on top make it even harder to reverse.`;
}

function feeTemplate(i: ActivityItem): string {
  if (i.fee == null) return 'This entry does not include a fee figure. Some accounts don’t report fees, and receiving usually costs you nothing.';
  const fee = `${i.fee.toLocaleString('en-US')} sats`;
  if (ONCHAIN.has(i.layer)) return `The ${fee} fee went to the bitcoin miner who included this transaction in a block. On-chain fees depend on the transaction’s size and how busy the network is, not on the amount sent.`;
  if (i.type === 'swap') return `The ${fee} fee went to the swap provider for exchanging the assets. It was part of the quote you accepted before the swap ran.`;
  return `The ${fee} fee paid the Lightning nodes that carried this payment to the recipient. Lightning fees are usually tiny and grow a little with the amount and the route.`;
}

function rgbTemplate(i: ActivityItem): string {
  const rgb = i.rgbTransfer;
  if (!rgb) return activityTemplate(i);
  const step = RGB_TRANSFER_STATUS_LABEL[rgb.status];
  return `This is an RGB transfer of ${amountOf(i)}. Its current step is “${step}”: ${rgbTransferStatusDetail(rgb.status, rgb.direction)} RGB transfers need both wallets to take part and a bitcoin transaction to confirm.`;
}

function errorTemplate(s: Extract<ExplainSubject, { type: 'error' }>): string {
  if (s.context === 'swap') {
    const copy = describeSwapFailure(s.message);
    const base = copy.title === 'Swap failed' ? s.message : copy.message;
    return /may still|not confirmed/i.test(s.message)
      ? `${base} A swap either finishes on both sides or not at all, so wait for its final status.`
      : `${base} A swap either finishes on both sides or not at all.`;
  }
  const m = s.message;
  if (/insufficient|not enough|balance/i.test(m)) return 'Your account does not hold enough for this amount plus its fee. Lower the amount or add funds, then try again.';
  if (/no route|route|liquidity|capacity/i.test(m)) return 'There was no Lightning path with enough room to carry this payment. A smaller amount, another account, or trying again later often works.';
  if (/expired|expiry/i.test(m)) return 'The request or quote expired before it was used. Ask for a new invoice or refresh the quote, then try again.';
  if (/network|timed? ?out|fetch|connect|unreachable|offline/i.test(m)) return 'The wallet could not reach the service it needed. Check your connection, then look at Activity before trying again so nothing is paid twice.';
  if (/invalid|not payable|decode|unsupported/i.test(m)) return 'The wallet could not read this code or address, or it is for a network this wallet does not use. Check it with the sender.';
  return 'Something went wrong while doing this. Check Activity to see whether anything changed before you try again.';
}

export function explainTemplate(s: ExplainSubject): string {
  switch (s.type) {
    case 'activity': return activityTemplate(s.item);
    case 'fee': return feeTemplate(s.item);
    case 'rgb-transfer': return rgbTemplate(s.item);
    case 'error': return errorTemplate(s);
  }
}

export function explainTitle(s: ExplainSubject): string {
  switch (s.type) {
    case 'fee': return 'About this fee';
    case 'rgb-transfer': return 'About this RGB transfer';
    case 'error': return 'What went wrong';
    default: return 'About this payment';
  }
}

export const EXPLAIN_SYSTEM_PROMPT =
  'You explain one item from a bitcoin wallet to someone who is not technical. ' +
  'Write 2 to 4 short, plain sentences. Use only the facts given; never add numbers, ' +
  'names or advice that are not in them. No lists, no headings, no markdown.';

/** Keep 2–4 sentences, and reject any answer with a number the facts don't contain. */
export function acceptExplanation(reply: string, facts: Record<string, unknown>): string | null {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/[*#`_>]/g, '').replace(/\s+/g, ' ').trim();
  if (text.length < 20) return null;
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((x) => x.trim()) ?? [text];
  if (sentences.length < 2) return null;
  const known = new Set((JSON.stringify(facts).match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]$/, '')));
  const used = (text.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]$/, ''));
  const allowedSmall = (n: string) => Number(n) <= 4;
  if (used.some((n) => !known.has(n) && !allowedSmall(n))) return null;
  return sentences.slice(0, 4).join(' ');
}

export async function explain(subject: ExplainSubject, model?: LocalTextModel | null): Promise<Explanation> {
  const title = explainTitle(subject);
  const fallback: Explanation = { title, text: explainTemplate(subject), source: 'template' };
  if (!model?.ready()) return fallback;
  const facts = subjectFacts(subject);
  try {
    const reply = await model.complete(EXPLAIN_SYSTEM_PROMPT, `Facts: ${JSON.stringify(facts)}`, { maxTokens: 180 });
    const text = acceptExplanation(reply, facts);
    return text ? { title, text, source: 'model' } : fallback;
  } catch {
    return fallback;
  }
}
