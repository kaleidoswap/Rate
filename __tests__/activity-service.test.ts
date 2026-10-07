jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const adapters: Record<string, any> = {};

jest.mock('../services/protocols', () => ({
  protocolManager: {
    getAdapterIfAvailable: jest.fn((name: string) => adapters[name]),
  },
  rgbAccountAdapter: () => adapters.RGB_LN ?? adapters.RGB_L1,
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadActivity } from '../services/ActivityService';

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
