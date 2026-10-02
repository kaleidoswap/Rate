const adapters: Record<string, any> = {};

jest.mock('../services/protocols', () => ({
  protocolManager: {
    getAdapterIfAvailable: jest.fn((name: string) => adapters[name]),
  },
}));

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
