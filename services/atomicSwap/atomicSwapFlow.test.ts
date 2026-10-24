import { AtomicSwapClient, type AtomicQuote } from './atomicClient';
import { executeAtomicSwap, resumeAtomicSwap, type AtomicSwapWallet } from './atomicSwapFlow';

const NOW = 1_800_000_000;
const quote: AtomicQuote = {
  id: 'S1', pair: 'BTC/USDT-RGB', direction: 'from', fromAmount: 100_000n, toAmount: 95_000_000n, assetId: 'rgb:usdt',
  networkFeeSat: 1_200n, serviceFee: 500_000n, expiresAt: BigInt(NOW + 60), offerExpiresAt: BigInt(NOW + 300), offer: '{"swap_id":"o"}',
};
const status = (s: string) => ({ id: 'S1', pair: 'BTC/USDT-RGB', status: s, txid: 'tx' } as any);

function setup(final = 'transaction.claimed') {
  const calls: string[] = [];
  const wallet: AtomicSwapWallet = {
    walletOutpoints: jest.fn(async () => { calls.push('outpoints'); return [{ txid: 'a'.repeat(64), vout: 0 }]; }),
    acceptSwapOffer: jest.fn(async () => { calls.push('accept offer'); return '{"request":1}'; }),
    completeSwapProposal: jest.fn(async () => { calls.push('sign'); return '{"completion":1}'; }),
    acceptSwapTransfers: jest.fn(async () => { calls.push('accept transfers'); }),
  };
  const client = {
    request: jest.fn(async () => { calls.push('post request'); return { id: 'S1', status: 'transaction.proposed', proposal: '{"proposal":1}', makerInputs: [] }; }),
    complete: jest.fn(async () => { calls.push('post completion'); return { id: 'S1', status: 'transaction.mempool', txid: 'tx', completion: '{"final":1}' }; }),
    track: jest.fn(async () => { calls.push('track'); return status(final); }),
  } as unknown as AtomicSwapClient;
  return { calls, wallet, client };
}

it('runs the wallet and maker steps in order and accepts the transfers once claimed', async () => {
  const { calls, wallet, client } = setup();
  const steps: string[] = [];
  const kept: string[] = [];
  const run = await executeAtomicSwap(client, wallet, quote, {
    now: () => NOW, onStep: (s) => steps.push(s), onBroadcast: (c) => { kept.push(c.completion); },
  });
  expect(calls).toEqual(['accept offer', 'outpoints', 'post request', 'sign', 'post completion', 'track', 'accept transfers']);
  expect(steps).toEqual(['requesting', 'signing', 'broadcasting', 'settling', 'accepting']);
  expect(wallet.acceptSwapOffer).toHaveBeenCalledWith('{"swap_id":"o"}');
  expect(client.request).toHaveBeenCalledWith('S1', '{"request":1}', [{ txid: 'a'.repeat(64), vout: 0 }]);
  expect(wallet.completeSwapProposal).toHaveBeenCalledWith('{"proposal":1}');
  expect(wallet.acceptSwapTransfers).toHaveBeenCalledWith('{"final":1}');
  expect(kept).toEqual(['{"final":1}']);
  expect(run).toMatchObject({ id: 'S1', txid: 'tx', accepted: true });
});

it('touches nothing for an expired quote', async () => {
  const { calls, wallet, client } = setup();
  await expect(executeAtomicSwap(client, wallet, quote, { now: () => NOW + 60 })).rejects.toThrow(/expired/);
  expect(calls).toEqual([]);
});

it('does not sign past the offer deadline', async () => {
  const { calls, wallet, client } = setup();
  let t = NOW;
  (client.request as jest.Mock).mockImplementation(async () => { t = NOW + 300; return { id: 'S1', proposal: '{}', makerInputs: [] }; });
  await expect(executeAtomicSwap(client, wallet, quote, { now: () => t })).rejects.toThrow(/expired/);
  expect(calls).not.toContain('sign');
});

it('reports a swap that failed on chain without accepting anything', async () => {
  const { wallet, client } = setup('transaction.failed');
  const run = await resumeAtomicSwap(client, wallet, 'S1', '{"final":1}');
  expect(run).toMatchObject({ accepted: false, status: { status: 'transaction.failed' } });
  expect(wallet.acceptSwapTransfers).not.toHaveBeenCalled();
});
