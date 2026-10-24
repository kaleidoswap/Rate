/**
 * One atomic BTC <-> USDT-RGB swap, end to end, against a verified quote
 * (./atomicClient.ts): the wallet accepts the offer, the maker proposes, the
 * wallet signs, the maker signs last and broadcasts, and once the maker has
 * claimed its side the wallet accepts its own.
 *
 * Nothing here holds a key: the wallet steps are rgb-lib's, behind
 * {@link AtomicSwapWallet} (RgbLibRnAccount.atomicSwapWallet() on a
 * kaleidoswap/rgb-lib build). After the broadcast the swap can only settle or
 * fail on chain, never be refunded: `onBroadcast` hands the caller the
 * finalized completion to keep, so `resumeAtomicSwap` can accept the
 * transfers after a restart.
 */
import {
  AtomicSwapClient, AtomicSwapError, type AtomicCompletion, type AtomicOutpoint, type AtomicQuote,
  type AtomicSwapStatus, type AtomicTrackOptions,
} from './atomicClient';

/** The taker's rgb-lib wallet, JSON text in and out. */
export interface AtomicSwapWallet {
  /** Every coin the wallet holds (rgb-lib's list_unspents outpoints). */
  walletOutpoints(): Promise<AtomicOutpoint[]>;
  /** `accept_swap_offer`: the `OnchainSwapRequest` JSON for a verified offer. */
  acceptSwapOffer(offerJson: string): Promise<string>;
  /** `complete_swap_proposal`: the signed `OnchainSwapCompletion` JSON. */
  completeSwapProposal(proposalJson: string): Promise<string>;
  /** `accept_swap_transfers` as the taker, with the maker's finalized completion. */
  acceptSwapTransfers(completionJson: string): Promise<void>;
}

export type AtomicSwapStep = 'requesting' | 'signing' | 'broadcasting' | 'settling' | 'accepting';

export interface AtomicSwapRun {
  id: string;
  txid: string;
  /** The terminal status: `transaction.claimed` when the swap settled. */
  status: AtomicSwapStatus;
  /** Whether the wallet took its side (only after `transaction.claimed`). */
  accepted: boolean;
}

export interface AtomicSwapRunOptions extends Pick<AtomicTrackOptions, 'intervalMs' | 'signal'> {
  onStep?: (step: AtomicSwapStep) => void;
  onStatus?: (status: AtomicSwapStatus) => void;
  /** The swap is on chain: keep `completion.completion` to resume after a restart. */
  onBroadcast?: (completion: AtomicCompletion) => void | Promise<void>;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

const nowSecs = () => Math.floor(Date.now() / 1000);

/** Runs a verified quote to the end. Throws before the broadcast; after it, reports the terminal status. */
export async function executeAtomicSwap(
  client: AtomicSwapClient,
  wallet: AtomicSwapWallet,
  quote: AtomicQuote,
  { onStep, onStatus, onBroadcast, intervalMs, signal, now = nowSecs }: AtomicSwapRunOptions = {},
): Promise<AtomicSwapRun> {
  const deadline = (at: bigint, what: string) => {
    if (BigInt(now()) >= at) throw new AtomicSwapError('Generic', `The quote expired before ${what}. Request a new quote.`);
  };
  deadline(quote.expiresAt, 'the swap was requested');
  onStep?.('requesting');
  const request = await wallet.acceptSwapOffer(quote.offer);
  deadline(quote.expiresAt, 'the swap was requested');
  const proposal = await client.request(quote.id, request, await wallet.walletOutpoints());

  onStep?.('signing');
  deadline(quote.offerExpiresAt, 'the swap was signed');
  const signed = await wallet.completeSwapProposal(proposal.proposal);

  onStep?.('broadcasting');
  const completion = await client.complete(quote.id, signed);
  await onBroadcast?.(completion);

  return resumeAtomicSwap(client, wallet, quote.id, completion.completion, { onStep, onStatus, intervalMs, signal });
}

/** After the broadcast: wait for the maker to settle, then accept the wallet's side. */
export async function resumeAtomicSwap(
  client: AtomicSwapClient,
  wallet: AtomicSwapWallet,
  swapId: string,
  completionJson: string,
  { onStep, onStatus, intervalMs, signal }: Omit<AtomicSwapRunOptions, 'onBroadcast' | 'now'> = {},
): Promise<AtomicSwapRun> {
  onStep?.('settling');
  const status = await client.track(swapId, { intervalMs, signal, onStatus });
  if (status.status !== 'transaction.claimed') {
    return { id: swapId, txid: status.txid ?? '', status, accepted: false };
  }
  onStep?.('accepting');
  await wallet.acceptSwapTransfers(completionJson);
  return { id: swapId, txid: status.txid ?? '', status, accepted: true };
}
