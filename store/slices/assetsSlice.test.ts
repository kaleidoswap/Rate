import { configureStore } from '@reduxjs/toolkit';
import reducer, { setProtocolAssets, setRgbAssets, syncAssets } from './assetsSlice';
import { protocolManager, rgbAccountAdapter } from '../../services/protocols';

const mockUpsert = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/DatabaseService', () => ({
  __esModule: true,
  default: { getInstance: () => ({ upsertAsset: mockUpsert, getAssetsByWallet: jest.fn().mockResolvedValue([]) }) },
}));
jest.mock('../../services/protocols', () => ({
  protocolManager: { getAdapterIfAvailable: jest.fn() },
  rgbAccountAdapter: jest.fn(),
}));

const unified = (id: string, available: number) => ({ id, ticker: id.toUpperCase(), name: id, precision: 0, balance: { total: available + 1, available } });
const adapter = (assets: any[] | Error) => ({
  isConnected: () => true,
  refreshBalances: jest.fn().mockResolvedValue(undefined),
  listAssets: jest.fn(() => (assets instanceof Error ? Promise.reject(assets) : Promise.resolve(assets))),
});
const row = (asset_id: string, protocol: string | undefined, balance: number) =>
  ({ wallet_id: 1, asset_id, ticker: asset_id, name: asset_id, precision: 0, issued_supply: 0, balance, last_updated: 0, protocol }) as any;

const store = () => configureStore({ reducer: { assets: reducer } });

beforeEach(() => jest.clearAllMocks());

test("an account's fresh assets replace only its own", () => {
  const s = store();
  s.dispatch(setRgbAssets([row('rgb:a', 'RGB', 1), row('btkn1b', 'SPARK', 1)]));
  s.dispatch(setProtocolAssets({ protocol: 'SPARK', assets: [row('btkn1c', 'SPARK', 4)] }));
  expect(s.getState().assets.rgbAssets.map((a: any) => a.asset_id)).toEqual(['rgb:a', 'btkn1c']);
});

test('a sync writes the same records as the dashboard, and an account that fails keeps its assets', async () => {
  (rgbAccountAdapter as jest.Mock).mockReturnValue(adapter([unified('rgb:a', 5), { id: 'BTC', balance: {} }]));
  (protocolManager.getAdapterIfAvailable as jest.Mock).mockImplementation((p: string) =>
    p === 'SPARK' ? adapter(new Error('offline')) : undefined);
  const s = store();
  s.dispatch(setRgbAssets([row('rgb:gone', 'RGB', 1), row('btkn1b', 'SPARK', 2)]));

  await s.dispatch(syncAssets(7) as any);

  const assets = s.getState().assets.rgbAssets as any[];
  expect(assets.map((a) => `${a.protocol}:${a.asset_id}:${a.balance}`)).toEqual(['SPARK:btkn1b:2', 'RGB:rgb:a:5']);
  expect(assets[1].balanceDetail).toMatchObject({ settled: 6, spendable: 5 });
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ wallet_id: 7, asset_id: 'rgb:a', balance: 5 }));
  expect(s.getState().assets.lastSyncTime).toEqual(expect.any(Number));
});
