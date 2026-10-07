import { assetUsdValue, tokenUsdPrice, tokenValueSats, tokenValueUsd, usdToSats } from './portfolio';

const asset = (ticker: string, baseUnits: number, precision = 6, asset_id = ticker) =>
  ({ asset_id, ticker, precision, balance: { spendable: baseUnits } });

test('every dollar stablecoin is worth $1, whatever the case', () => {
  for (const t of ['USDT', 'USDt', 'usdc', 'USDB', 'DAI', 'BUSD', 'USD']) expect(tokenUsdPrice(t)).toBe(1);
  expect(tokenUsdPrice('XAUT')).toBeNull();
  expect(tokenUsdPrice(undefined)).toBeNull();
});

test('an asset is valued from the same balance its row shows', () => {
  expect(assetUsdValue(asset('USDT', 12_500_000))).toBe(12.5);
  expect(assetUsdValue(asset('XAUT', 1_000_000))).toBeUndefined();
  // Known dollar assets count even when their ticker says otherwise.
  expect(assetUsdValue(asset('L-USD', 2_000_000, 6, 'liquid-usdt'), new Set(['liquid-usdt']))).toBe(2);
});

test('the token value joins the total as sats at the live price', () => {
  const assets = [asset('USDT', 30_000_000), asset('USDB', 20_000_000, 6), asset('XAUT', 5)];
  expect(tokenValueUsd(assets)).toBe(50);
  // $50 at $100,000/BTC = 50,000 sats.
  expect(tokenValueSats(assets, 100_000)).toBe(50_000);
});

test('no price, no token value', () => {
  expect(tokenValueSats([asset('USDT', 1_000_000)], 0)).toBe(0);
  expect(usdToSats(10, NaN)).toBe(0);
});

test('BTC rows and empty balances add nothing', () => {
  expect(tokenValueUsd([{ asset_id: 'BTC', ticker: 'USD', precision: 0, balance: 100 }, asset('USDC', 0)])).toBe(0);
});
