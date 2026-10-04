jest.mock('./AssetIcon', () => ({ AssetIcon: () => null }));
import { groupAssets, type SelectableAsset } from './AssetSelector';

const asset = (ticker: string, balance?: number, extra: Partial<SelectableAsset> = {}): SelectableAsset =>
  ({ asset_id: `id-${ticker}`, ticker, name: `${ticker} token`, balance, ...extra });

const shape = (rows: ReturnType<typeof groupAssets>) =>
  rows.map(r => (r.kind === 'header' ? `# ${r.title}` : r.asset.ticker));

test('held assets come first, largest balance first, under their own heading', () => {
  expect(shape(groupAssets([asset('USDT', 0), asset('BTC', 5), asset('XAU', 50)], ''))).toEqual(
    ['# In your wallet', 'XAU', 'BTC', '# Other assets', 'USDT'],
  );
});

test('a single group has no heading, and unavailable assets never count as held', () => {
  expect(shape(groupAssets([asset('BTC', 5, { unavailable: 'No market' }), asset('USDT', 0)], ''))).toEqual(['BTC', 'USDT']);
  expect(shape(groupAssets([asset('BTC', 5), asset('USDT', 2)], ''))).toEqual(['BTC', 'USDT']);
});

test('search matches ticker, name or id, case-insensitively', () => {
  const list = [asset('BTC', 1), asset('USDT', 0, { name: 'Tether' })];
  expect(shape(groupAssets(list, 'teth'))).toEqual(['USDT']);
  expect(shape(groupAssets(list, ' btc '))).toEqual(['BTC']);
  expect(groupAssets(list, 'nothing')).toEqual([]);
});
