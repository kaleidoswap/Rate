jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const adapters: Record<string, any> = {};

jest.mock('../services/protocols', () => ({
  protocolManager: {
    getAdapterIfAvailable: jest.fn((name: string) => adapters[name]),
  },
  rgbAccountAdapter: () => adapters.RGB_LN ?? adapters.RGB_L1,
  rgbAccountIsOnDevice: () => !adapters.RGB_LN && !!adapters.RGB_L1,
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearActivityCache,
  loadActivity,
  mergeActivity,
  onchainBtcItems,
  streamActivity,
  type ActivityProgress,
} from '../services/ActivityService';

describe('ActivityService', () => {
  beforeEach(() => {
    for (const key of Object.keys(adapters)) delete adapters[key];
  });

  it('keeps confirmed Spark and Arkade transactions confirmed in activity', async () => {
    adapters.SPARK = {
      isConnected: () => true,
      listTransactions: jest.fn(async () => [
        {
          id: 'spark-receive',
          type: 'receive',
          status: 'confirmed',
          amount: 1234,
          timestamp: 1000,
          asset: { id: 'BTC', ticker: 'BTC', name: 'Bitcoin', precision: 8 },
        },
      ]),
    };
    adapters.ARKADE = {
      isConnected: () => true,
      listTransactions: jest.fn(async () => [
        {
          id: 'arkade-receive',
          type: 'receive',
          status: 'confirmed',
          amount: 5678,
          timestamp: 2000,
          asset: { id: 'BTC', ticker: 'BTC', name: 'Bitcoin', precision: 8 },
        },
      ]),
    };

    const { items } = await loadActivity();

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'spark-spark-receive', status: 'confirmed' }),
        expect.objectContaining({ id: 'arkade-arkade-receive', status: 'confirmed' }),
      ]),
    );
  });

  it('treats direct Spark receives as confirmed even when the raw transfer status is intermediate', async () => {
    adapters.SPARK = {
      isConnected: () => true,
      listTransactions: jest.fn(async () => [
        {
          id: 'spark-direct-receive',
          type: 'receive',
          status: 'pending',
          amount: 200,
          timestamp: 1000,
          asset: { id: 'BTC', ticker: 'BTC', name: 'Bitcoin', precision: 8 },
          protocolData: {
            id: 'spark-direct-receive',
            type: 'TRANSFER',
            status: 'TRANSFER_STATUS_RECEIVER_KEY_TWEAKED',
            totalValue: 200,
            receiverIdentityPublicKey: 'receiver',
            senderIdentityPublicKey: 'sender',
            userRequest: undefined,
          },
        },
      ]),
    };

    const { items } = await loadActivity();

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'spark-spark-direct-receive', status: 'confirmed' }),
      ]),
    );
  });

  it('lists Electrum swap payments as on-chain sends with their network', async () => {
    const { items } = await loadActivity({
      swapAttempts: [
        { id: 's1', failed: false, network: 'mainnet', amountSat: 49_000, fee: 304, txid: 'a'.repeat(64), confirmed: false, updatedAt: 3000 },
        { id: 's2', failed: false, network: 'signet', amountSat: 10_000, fee: 152, txid: 'b'.repeat(64), confirmed: true, updatedAt: 2000 },
        { id: 's3', failed: true, network: 'mainnet', amountSat: 5_000, updatedAt: 1000 } as any,
      ],
    });
    expect(items.map(i => [i.id, i.type, i.layer, i.source, i.status, i.network, i.swapAttemptId])).toEqual([
      ['electrum-s1', 'send', 'L1', 'onchain', 'pending', 'mainnet', 's1'],
      ['electrum-s2', 'send', 'L1', 'onchain', 'confirmed', 'signet', 's2'],
      ['electrum-s3', 'send', 'L1', 'onchain', 'failed', 'mainnet', 's3'],
    ]);
    expect(items[0]).toMatchObject({ amount: '49,000', rawSats: 49_000, fee: 304, assetTicker: 'sats' });
    expect(items[2].txid).toBe('');
  });
});

it('labels Bark signet history and preserves pending sends', async () => {
  for (const key of Object.keys(adapters)) delete adapters[key];
  adapters.BARK = {
    isConnected: () => true,
    getConnectionInfo: async () => ({ network: 'signet' }),
    listTransactions: async () => [{ id: 'movement-1', type: 'send', amount: 1000, fee: 12, status: 'pending', timestamp: 2000 }],
  };
  const { items } = await loadActivity();
  expect(items).toEqual([expect.objectContaining({ id: 'bark-movement-1', layer: 'Bark Signet', status: 'pending', rawSats: 1000, fee: 12 })]);
});

test('unknown payment outcomes stay distinct from pending and keep account metadata', async () => {
  for (const key of Object.keys(adapters)) delete adapters[key];
  adapters.SPARK = {
    isConnected: () => true,
    getConnectionInfo: async () => ({ network: 'regtest' }),
    listTransactions: async () => [
      { id: 'uncertain', type: 'send', status: 'unknown', amount: 10 },
      { id: 'submitted', type: 'send', status: 'pending', amount: 20 },
      { id: 'unexpected', type: 'send', status: 'new_provider_state', amount: 30 },
    ],
  };
  const { items } = await loadActivity();
  expect(items.find(i => i.id === 'spark-uncertain')).toMatchObject({ status: 'unknown', account: 'SPARK', network: 'regtest' });
  expect(items.find(i => i.id === 'spark-submitted')?.status).toBe('pending');
  expect(items.find(i => i.id === 'spark-unexpected')?.status).toBe('unknown');
});

describe('ActivityService proofs and cross-chain orders', () => {
  const PREIMAGE = 'ab'.repeat(32);

  beforeEach(async () => {
    for (const key of Object.keys(adapters)) delete adapters[key];
    await AsyncStorage.clear();
  });

  it('carries the preimage of a paid Lightning invoice from the node history', async () => {
    adapters.RGB_LN = {
      isConnected: () => true,
      listPayments: jest.fn(async () => [
        { payment_hash: 'h1', amt_msat: 5000, inbound: false, status: 'Succeeded', created_at: 1, preimage: PREIMAGE.toUpperCase() },
        { payment_hash: 'h2', amt_msat: 5000, inbound: true, status: 'Succeeded', created_at: 2, preimage: PREIMAGE },
      ]),
      listTransfers: jest.fn(async () => []),
    };
    const { items } = await loadActivity();
    expect(items.find((i) => i.paymentHash === 'h1')?.preimage).toBe(PREIMAGE);
    expect(items.find((i) => i.paymentHash === 'h2')?.preimage).toBeUndefined();
  });

  it('reads the preimage and request id of a Spark Lightning send', async () => {
    adapters.SPARK = {
      isConnected: () => true,
      listTransactions: jest.fn(async () => [{
        id: 'transfer-1', type: 'send', status: 'confirmed', amount: 100, timestamp: 1,
        protocolData: { userRequest: { id: 'req-1', paymentPreimage: PREIMAGE } },
      }]),
    };
    const { items } = await loadActivity();
    expect(items[0]).toMatchObject({ preimage: PREIMAGE, requestId: 'req-1' });
  });

  it('lists this wallet\'s cross-chain orders', async () => {
    await AsyncStorage.setItem('crosschain-history-v1-7', JSON.stringify([
      { id: 'q1', direction: 'deposit', sourceChain: 'ethereum', sourceAsset: 'USDT', destChain: 'spark', destAsset: 'BTC',
        amountInRaw: '2000000', sourceDecimals: 6, amountOutRaw: '3000', destDecimals: 8, orderId: 'o1', status: 'completed', createdAt: 5, updatedAt: 5 },
      { id: 'q2', direction: 'send', sourceChain: 'spark', sourceAsset: 'USDB', destChain: 'base', destAsset: 'USDC',
        amountInRaw: '5000000', sourceDecimals: 6, destDecimals: 6, recipient: '0xdef', status: 'failed', createdAt: 6, updatedAt: 6 },
    ]));
    const { items } = await loadActivity({ walletId: 7 });
    expect(items).toEqual([
      expect.objectContaining({ id: 'crosschain-q2', type: 'send', amount: '5', assetTicker: 'USDB', status: 'failed', assetName: 'To USDC on Base', layer: 'Cross-chain' }),
      expect.objectContaining({ id: 'crosschain-q1', type: 'receive', rawSats: 3000, status: 'confirmed', assetName: 'From USDT on Ethereum', txid: 'o1' }),
    ]);
    expect((await loadActivity({ walletId: 8 })).items).toEqual([]);
  });
});

describe('on-chain BTC of the RGB account', () => {
  const tx = (id: string, over: any = {}) => ({
    id, type: 'receive', status: 'confirmed', amount: 10_000, timestamp: 5000,
    asset: { id: 'BTC', layer: 'BTC_L1' }, protocolData: { txid: id, fee: 0 }, ...over,
  });

  beforeEach(() => {
    for (const key of Object.keys(adapters)) delete adapters[key];
  });

  it('maps direction, amount net of fee, status and network', () => {
    const items = onchainBtcItems([
      tx('r1'),
      tx('s1', { type: 'send', status: 'pending', amount: 5_210, timestamp: 0, protocolData: { fee: 210, transaction_type: 'User' } }),
    ], 'signet', new Set());
    expect(items).toEqual([
      expect.objectContaining({ id: 'onchain-r1', type: 'receive', layer: 'L1', source: 'onchain', status: 'confirmed', rawSats: 10_000, fee: undefined, account: 'RGB', network: 'signet', txid: 'r1', timestamp: 5000 }),
      expect.objectContaining({ id: 'onchain-s1', type: 'send', status: 'pending', rawSats: 5_000, amount: '5,000', fee: 210, kind: 'User', timestamp: undefined }),
    ]);
  });

  it('skips Lightning rows and txids another source lists', () => {
    const items = onchainBtcItems([
      tx('dup'),
      tx('ln', { asset: { id: 'BTC', layer: 'BTC_LN' } }),
      tx('', {}),
      tx('keep'),
    ], undefined, new Set(['dup']));
    expect(items.map((i) => i.txid)).toEqual(['keep']);
  });

  it('lists the node wallet\'s on-chain BTC once, next to its RGB transfer', async () => {
    adapters.RGB_LN = {
      isConnected: () => true,
      getConnectionInfo: async () => ({ network: 'regtest' }),
      listPayments: async () => [],
      listTransfers: async () => [{ txid: 'rgbsend', kind: 'Send', status: 'Settled', created_at: 1, requested_assignment: { value: 5 } }],
      listTransactions: async () => [tx('rgbsend', { type: 'send' }), tx('deposit')],
    };
    const { items } = await loadActivity({ assets: [{ asset_id: 'rgb:a', ticker: 'USDT', name: 'Tether', precision: 0 }] });
    expect(items.map((i) => [i.id, i.layer, i.network])).toEqual([
      ['onchain-deposit', 'L1', 'regtest'],
      ['transfer-rgbsend-0', 'RGB-L1', 'regtest'],
    ]);
  });

  it('does not ask an NWC wallet for an on-chain list', async () => {
    const listTransactions = jest.fn(async () => [tx('ln-invoice')]);
    adapters.RGB_LN = { isConnected: () => true, walletType: () => 'rln', listPayments: async () => [], listTransactions };
    const { items } = await loadActivity();
    expect(listTransactions).not.toHaveBeenCalled();
    expect(items).toEqual([]);
  });

  it('lists the NWC node’s on-chain history when its connection allows it', async () => {
    const listTransactions = jest.fn(async () => [tx('ln-invoice')]);
    adapters.RGB_LN = {
      isConnected: () => true, walletType: () => 'rln', hasRlnMethod: (m: string) => m === 'rln_list_transactions',
      listPayments: async () => [], listTransactions, listOnchainTransactions: async () => [tx('deposit')],
    };
    const { items } = await loadActivity();
    expect(listTransactions).not.toHaveBeenCalled();
    expect(items.map((i) => i.id)).toEqual(['onchain-deposit']);
  });

  it('RGB transfers carry their own progress, and an invoice that expired unused is left out', async () => {
    adapters.RGB_L1 = {
      isConnected: () => true,
      getConnectionInfo: async () => ({ network: 'signet' }),
      listPayments: async () => [],
      listTransfers: async () => [
        { idx: 1, batch_transfer_idx: 4, kind: 'ReceiveWitness', status: 'WaitingCounterparty', created_at: 3, recipient_id: 'open' },
        { idx: 2, batch_transfer_idx: 5, kind: 'ReceiveWitness', status: 'Failed', created_at: 2, recipient_id: 'expired' },
        { idx: 3, batch_transfer_idx: 6, kind: 'Send', status: 'WaitingConfirmations', created_at: 1, txid: 'f'.repeat(64), requested_assignment: { value: 1500 } },
      ],
    };
    const { items } = await loadActivity({ assets: [{ asset_id: 'rgb:a', ticker: 'USDT', name: 'Tether', precision: 2 }] });
    expect(items.map((i) => [i.type, i.status, i.rgbTransfer?.status, i.rgbTransfer?.batchTransferIdx, i.amount])).toEqual([
      ['receive', 'pending', 'waiting-counterparty', 4, '0'],
      ['send', 'pending', 'waiting-confirmations', 6, '15'],
    ]);
  });

  it('counts a failed on-chain list as a failed source', async () => {
    adapters.RGB_LN = { isConnected: () => true, listPayments: async () => [], listTransactions: async () => { throw new Error('down'); } };
    expect((await loadActivity()).failedSources).toBe(1);
  });
});

describe('streamActivity', () => {
  const btc = { id: 'BTC', ticker: 'BTC', name: 'Bitcoin', precision: 8 };
  const sparkTx = (id: string, timestamp: number) => ({ id, type: 'receive', status: 'confirmed', amount: 100, timestamp, asset: btc });
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  beforeEach(() => {
    for (const key of Object.keys(adapters)) delete adapters[key];
    clearActivityCache();
  });

  it('shows swaps at once and adds each account as it answers', async () => {
    const arkade = deferred<any[]>();
    adapters.SPARK = { isConnected: () => true, listTransactions: async () => [sparkTx('s1', 1000)] };
    adapters.ARKADE = { isConnected: () => true, listTransactions: () => arkade.promise };
    const updates: ActivityProgress[] = [];
    const { done } = streamActivity(
      { swaps: [{ rfq_id: 'r1', status: 'completed', created_at: 500 }] },
      (p) => updates.push(p),
    );

    expect(updates[0]).toMatchObject({ pending: 2 });
    expect(updates[0].items.map((i) => i.id)).toEqual(['swap-r1']);
    await new Promise((r) => setTimeout(r, 0));
    expect(updates.at(-1)!.pending).toBe(1);
    expect(updates.at(-1)!.items.map((i) => i.id)).toEqual(['spark-s1', 'swap-r1']);

    arkade.resolve([sparkTx('a1', 2000)]);
    const final = await done;
    expect(final.pending).toBe(0);
    expect(final.items.map((i) => i.id)).toEqual(['arkade-a1', 'spark-s1', 'swap-r1']);
  });

  it('does not wait for a source that never answers', async () => {
    adapters.SPARK = { isConnected: () => true, listTransactions: async () => [sparkTx('s1', 1000)] };
    adapters.ARKADE = { isConnected: () => true, listTransactions: () => new Promise(() => {}) };
    const result = await streamActivity({ timeoutMs: 30 }).done;
    expect(result.items.map((i) => i.id)).toEqual(['spark-s1']);
    expect(result.failedSources).toBe(1);
  });

  it('keeps the last items of a source that fails, and drops a disconnected one', async () => {
    let arkadeDown = false;
    adapters.SPARK = { isConnected: () => true, listTransactions: async () => [sparkTx('s1', 1000)] };
    adapters.ARKADE = {
      isConnected: () => true,
      listTransactions: async () => { if (arkadeDown) throw new Error('down'); return [sparkTx('a1', 2000)]; },
    };
    await streamActivity({ walletId: 3, useCache: true }).done;

    arkadeDown = true;
    const updates: ActivityProgress[] = [];
    const again = await streamActivity({ walletId: 3, useCache: true }, (p) => updates.push(p)).done;
    expect(updates[0].items.map((i) => i.id)).toEqual(['arkade-a1', 'spark-s1']);
    expect(again.items.map((i) => i.id)).toEqual(['arkade-a1', 'spark-s1']);
    expect(again.failedSources).toBe(1);

    delete adapters.ARKADE;
    expect((await streamActivity({ walletId: 3, useCache: true }).done).items.map((i) => i.id)).toEqual(['spark-s1']);
    // Another wallet starts empty.
    expect((await streamActivity({ walletId: 4, useCache: true }).done).items.map((i) => i.id)).toEqual(['spark-s1']);
  });

  it('hides an on-chain tx once its RGB transfer arrives, whichever lands first', async () => {
    const transfers = deferred<any[]>();
    adapters.RGB_LN = {
      isConnected: () => true,
      listPayments: async () => [],
      listTransfers: () => transfers.promise,
      listTransactions: async () => [
        { id: 'rgbsend', type: 'send', status: 'confirmed', amount: 1000, timestamp: 5000, asset: { id: 'BTC', layer: 'BTC_L1' } },
      ],
    };
    const updates: ActivityProgress[] = [];
    const { done } = streamActivity({ assets: [{ asset_id: 'rgb:a', ticker: 'USDT', name: 'Tether', precision: 0 }] }, (p) => updates.push(p));
    await new Promise((r) => setTimeout(r, 0));
    expect(updates.at(-1)!.items.map((i) => i.id)).toEqual(['onchain-rgbsend']);

    transfers.resolve([{ txid: 'rgbsend', kind: 'Send', status: 'Settled', created_at: 1, requested_assignment: { value: 5 } }]);
    expect((await done).items.map((i) => i.id)).toEqual(['transfer-rgbsend-0']);
  });

  const assetList = [
    { asset_id: 'rgb:a', ticker: 'AAA', name: 'A', precision: 0 },
    { asset_id: 'rgb:b', ticker: 'BBB', name: 'B', precision: 0 },
    { asset_id: 'rgb:c', ticker: 'CCC', name: 'C', precision: 0 },
  ];
  const trackingTransfers = () => {
    let active = 0;
    let peak = 0;
    const listTransfers = jest.fn(async ({ asset_id }: { asset_id: string }) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return [{ txid: `tx-${asset_id}`, kind: 'Send', status: 'Settled', created_at: 1 }];
    });
    return { listTransfers, peak: () => peak };
  };

  it('asks RGB on this phone for one asset\'s transfers at a time', async () => {
    const t = trackingTransfers();
    adapters.RGB_L1 = { isConnected: () => true, listPayments: async () => [], listTransfers: t.listTransfers };
    const { items } = await streamActivity({ assets: assetList }).done;
    expect(t.listTransfers.mock.calls.map(([a]) => a.asset_id)).toEqual(['rgb:a', 'rgb:b', 'rgb:c']);
    expect(t.peak()).toBe(1);
    expect(items).toHaveLength(3);
  });

  it('asks the RGB node for every asset\'s transfers together', async () => {
    const t = trackingTransfers();
    adapters.RGB_LN = { isConnected: () => true, listPayments: async () => [], listTransfers: t.listTransfers };
    await streamActivity({ assets: assetList }).done;
    expect(t.peak()).toBe(3);
  });

  it('reuses a call still running from the previous load', async () => {
    const pending = deferred<any[]>();
    const listTransactions = jest.fn(() => pending.promise);
    adapters.SPARK = { isConnected: () => true, listTransactions };
    const first = streamActivity({ timeoutMs: 20 }).done;
    await first;
    const second = streamActivity().done;
    pending.resolve([sparkTx('s1', 1)]);
    expect((await second).items.map((i) => i.id)).toEqual(['spark-s1']);
    expect(listTransactions).toHaveBeenCalledTimes(1);
  });

  it('retries a call that looks stuck', async () => {
    const listTransactions = jest.fn()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce([sparkTx('s1', 1)]);
    adapters.SPARK = { isConnected: () => true, listTransactions };
    await streamActivity({ walletId: 9, timeoutMs: 5 }).done;
    await new Promise((r) => setTimeout(r, 20));
    expect((await streamActivity({ walletId: 9, timeoutMs: 5 }).done).items.map((i) => i.id)).toEqual(['spark-s1']);
    expect(listTransactions).toHaveBeenCalledTimes(2);
  });

  it('stops reporting once cancelled', async () => {
    const spark = deferred<any[]>();
    adapters.SPARK = { isConnected: () => true, listTransactions: () => spark.promise };
    const onUpdate = jest.fn();
    const { done, cancel } = streamActivity({}, onUpdate);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    cancel();
    spark.resolve([sparkTx('s1', 1)]);
    await done;
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('merges like a single load', () => {
    const item = (id: string, txid: string, timestamp?: number) => ({ id, txid, timestamp } as any);
    expect(mergeActivity({
      swaps: [item('swap-1', 'abc', 10)],
      onchain: [item('onchain-abc', 'abc', 30), item('onchain-def', 'def', undefined)],
      SPARK: [item('spark-1', 's', 20)],
    }).map((i) => i.id)).toEqual(['spark-1', 'swap-1', 'onchain-def']);
  });
});
