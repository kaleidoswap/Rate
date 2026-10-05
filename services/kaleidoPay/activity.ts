// services/kaleidoPay/activity.ts
//
// Electrum swap attempts as activity-feed input. Each paid swap ends in an
// on-chain payment to the requested address: the provider's lockup, then the
// app's claim. Confirmation comes from mempool.space and is cached once final.

import type { SwapAttempt } from '@universal-bolt12/swap-market';
import { MempoolClient } from '../mempool/MempoolClient';
import type { SwapAttemptActivityInput } from '../ActivityService';
import { kaleidoPayAttempts } from './recovery';

/** Status lookups per feed load; older swaps are shown without one. */
const MAX_STATUS_CHECKS = 10;
const confirmedTxids = new Set<string>();

export function swapAttemptTxid(a: SwapAttempt): string | undefined {
  return a.claim?.txid ?? a.lockup?.txid;
}

export async function loadSwapAttemptActivity(
  deps: { list?: () => Promise<SwapAttempt[]>; client?: (n: SwapAttempt['swap']['network']) => MempoolClient } = {},
): Promise<SwapAttemptActivityInput[]> {
  const list = deps.list ?? (() => kaleidoPayAttempts.list());
  const client = deps.client ?? (n => new MempoolClient(n));
  const attempts = (await list().catch(() => [] as SwapAttempt[]))
    // Never-paid swaps moved no funds.
    .filter(a => a.stage !== 'created' && !(a.stage === 'failed' && a.error === 'never paid'))
    .sort((x, y) => y.updatedAt - x.updatedAt);

  let checks = 0;
  return Promise.all(attempts.map(async a => {
    const txid = swapAttemptTxid(a);
    let txConfirmed = !!txid && confirmedTxids.has(txid);
    if (txid && !txConfirmed && a.stage !== 'failed' && checks++ < MAX_STATUS_CHECKS) {
      txConfirmed = await client(a.swap.network).getTxStatus(txid).then(s => s.confirmed, () => false);
      if (txConfirmed) confirmedTxids.add(txid);
    }
    return {
      id: a.id,
      failed: a.stage === 'failed',
      network: a.swap.network,
      amountSat: a.swap.onchainAmount - (a.claim?.fee ?? 0),
      fee: a.claim?.fee,
      txid,
      // The payment lands with the claim; a confirmed lockup alone is still pending.
      confirmed: !!a.claim && txConfirmed,
      updatedAt: a.updatedAt,
    };
  }));
}
