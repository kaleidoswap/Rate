jest.mock('../services/kaleidoPay/recovery', () => ({ kaleidoPayAttempts: { list: jest.fn(async () => []) } }));

import type { SwapAttempt } from '@universal-bolt12/swap-market';
import { loadSwapAttemptActivity } from '../services/kaleidoPay/activity';

const attempt = (id: string, over: Partial<SwapAttempt>): SwapAttempt => ({
  id,
  stage: 'claimed',
  quote: {} as any,
  swap: { network: 'mainnet', onchainAmount: 50_000 } as any,
  updatedAt: 1,
  ...over,
});

describe('loadSwapAttemptActivity', () => {
  it('skips unpaid swaps and marks a payment confirmed only once its claim confirms', async () => {
    const confirmed = new Set(['claim1', 'lockup2']);
    const getTxStatus = jest.fn(async (txid: string) => ({ confirmed: confirmed.has(txid) }));
    const rows = await loadSwapAttemptActivity({
      list: async () => [
        attempt('a1', { claim: { txid: 'claim1', hex: '', fee: 300 }, lockup: { txid: 'lockup1', vout: 0, confirmed: true }, updatedAt: 5 }),
        attempt('a2', { stage: 'lockup_seen', lockup: { txid: 'lockup2', vout: 0, confirmed: true }, updatedAt: 4 }),
        attempt('a3', { stage: 'created', updatedAt: 3 }),
        attempt('a4', { stage: 'failed', error: 'never paid', updatedAt: 2 }),
        attempt('a5', { stage: 'failed', error: 'lockup timed out', updatedAt: 1 }),
      ],
      client: () => ({ getTxStatus }) as any,
    });
    expect(rows).toEqual([
      { id: 'a1', failed: false, network: 'mainnet', amountSat: 49_700, fee: 300, txid: 'claim1', confirmed: true, updatedAt: 5 },
      { id: 'a2', failed: false, network: 'mainnet', amountSat: 50_000, fee: undefined, txid: 'lockup2', confirmed: false, updatedAt: 4 },
      { id: 'a5', failed: true, network: 'mainnet', amountSat: 50_000, fee: undefined, txid: undefined, confirmed: false, updatedAt: 1 },
    ]);
    // Failed swaps are not looked up.
    expect(getTxStatus).toHaveBeenCalledTimes(2);
  });

  it('treats an unreachable explorer as unconfirmed', async () => {
    const rows = await loadSwapAttemptActivity({
      list: async () => [attempt('a1', { claim: { txid: 'claim9', hex: '', fee: 300 } })],
      client: () => ({ getTxStatus: async () => { throw new Error('offline'); } }) as any,
    });
    expect(rows[0].confirmed).toBe(false);
  });
});
