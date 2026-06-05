// Mock the heavy/native import chain so we can unit-test the pure formatters.
jest.mock('react-redux', () => ({ useSelector: jest.fn(), useDispatch: jest.fn() }));
jest.mock('../services/PriceService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));

import {
  formatBitcoinAmount,
  parseInputAmount,
  convertAmountToUnit,
  btcToSats,
  satsToBtc,
  formatSatoshisToUSD,
  formatDenominatedAmount,
} from './bitcoinUnits';

describe('formatBitcoinAmount (input is ALWAYS satoshis)', () => {
  describe('sats unit', () => {
    it('renders whole sats with thousands separators', () => {
      expect(formatBitcoinAmount(0, 'sats')).toBe('0');
      expect(formatBitcoinAmount(999, 'sats')).toBe('999');
      expect(formatBitcoinAmount(1001, 'sats')).toBe('1,001');
      expect(formatBitcoinAmount(50_000_000, 'sats')).toBe('50,000,000');
    });

    // Regression: the old magnitude-guessing impl rendered any value >= 1 BTC
    // worth of sats incorrectly. 2 BTC = 200,000,000 sats must NOT become "2".
    it('renders a >= 1 BTC balance correctly in sats', () => {
      expect(formatBitcoinAmount(200_000_000, 'sats')).toBe('200,000,000');
    });
  });

  describe('BTC unit', () => {
    it('converts sats to a fixed-8 BTC string', () => {
      expect(formatBitcoinAmount(0, 'BTC')).toBe('0.00000000');
      expect(formatBitcoinAmount(1, 'BTC')).toBe('0.00000001');
      expect(formatBitcoinAmount(50_000_000, 'BTC')).toBe('0.50000000');
      expect(formatBitcoinAmount(100_000_000, 'BTC')).toBe('1.00000000');
      // Regression: 2 BTC of sats must render as 2 BTC, not "2".
      expect(formatBitcoinAmount(200_000_000, 'BTC')).toBe('2.00000000');
    });
  });

  it('accepts numeric strings as input', () => {
    expect(formatBitcoinAmount('150000000', 'BTC')).toBe('1.50000000');
    expect(formatBitcoinAmount('1234', 'sats')).toBe('1,234');
  });

  it('returns "0" for non-finite / unparseable input', () => {
    expect(formatBitcoinAmount('abc', 'sats')).toBe('0');
    expect(formatBitcoinAmount(NaN, 'BTC')).toBe('0');
    expect(formatBitcoinAmount(Infinity, 'sats')).toBe('0');
  });
});

describe('btcToSats / satsToBtc round-trip', () => {
  it('converts BTC to sats', () => {
    expect(btcToSats(1)).toBe('100000000');
    expect(btcToSats('0.5')).toBe('50000000');
    expect(btcToSats('not-a-number')).toBe('0');
  });

  it('converts sats to BTC', () => {
    expect(satsToBtc(100_000_000)).toBe('1.00000000');
    expect(satsToBtc('50000000')).toBe('0.50000000');
  });
});

describe('convertAmountToUnit', () => {
  it('is a no-op when units match', () => {
    expect(convertAmountToUnit('1.5', 'BTC', 'BTC')).toBe('1.5');
    expect(convertAmountToUnit(42, 'sats', 'sats')).toBe('42');
  });

  it('converts between BTC and sats', () => {
    expect(convertAmountToUnit('1', 'BTC', 'sats')).toBe('100000000');
    expect(convertAmountToUnit('100000000', 'sats', 'BTC')).toBe('1.00000000');
  });
});

describe('parseInputAmount (sanitizes user input within its unit)', () => {
  it('floors sats and fixes BTC to 8 decimals', () => {
    expect(parseInputAmount('1234.9', 'sats')).toBe('1234');
    expect(parseInputAmount('0.5', 'BTC')).toBe('0.50000000');
    expect(parseInputAmount('', 'sats')).toBe('0');
  });
});

describe('formatDenominatedAmount', () => {
  const price = 100_000; // $100k / BTC → 1 sat = $0.001

  it('formats sats denomination with a fiat sub-line', () => {
    const r = formatDenominatedAmount(50_000, { denomination: 'sats', price });
    expect(r.primary).toBe('50,000');
    expect(r.unitLabel).toBe('sats');
    expect(r.secondary).toBe('$50.00 USD');
    expect(r.hidden).toBe(false);
  });

  it('formats BTC denomination with a fiat sub-line', () => {
    const r = formatDenominatedAmount(200_000_000, { denomination: 'BTC', price });
    expect(r.primary).toBe('2.00000000');
    expect(r.unitLabel).toBe('BTC');
    expect(r.secondary).toBe('$200,000.00 USD');
  });

  it('formats fiat denomination with a sats sub-line', () => {
    const r = formatDenominatedAmount(50_000, { denomination: 'fiat', price, currency: 'USD' });
    expect(r.primary).toBe('$50.00');
    expect(r.unitLabel).toBe('USD');
    expect(r.secondary).toBe('50,000 sats');
  });

  it('degrades fiat → sats when no price is available (no misleading $0)', () => {
    const r = formatDenominatedAmount(50_000, { denomination: 'fiat', price: 0 });
    expect(r.primary).toBe('50,000');
    expect(r.unitLabel).toBe('sats');
    expect(r.secondary).toBe(''); // no fiat sub-line without a price
  });

  it('omits the fiat sub-line for sats/BTC when no price', () => {
    expect(formatDenominatedAmount(50_000, { denomination: 'sats' }).secondary).toBe('');
    expect(formatDenominatedAmount(50_000, { denomination: 'BTC' }).secondary).toBe('');
  });

  it('hides everything when hideBalances is set', () => {
    const r = formatDenominatedAmount(50_000, { denomination: 'fiat', price, hideBalances: true });
    expect(r.hidden).toBe(true);
    expect(r.primary).not.toContain('50');
    expect(r.secondary).toBe('');
  });

  it('treats unparseable input as zero', () => {
    expect(formatDenominatedAmount('xyz', { denomination: 'sats' }).primary).toBe('0');
  });
});

describe('formatSatoshisToUSD', () => {
  it('converts sats to a 2-decimal USD string at the given price', () => {
    expect(formatSatoshisToUSD(100_000_000, 50_000)).toBe('50000.00');
    expect(formatSatoshisToUSD(50_000_000, 60_000)).toBe('30000.00');
  });

  it('returns "0.00" when price is missing or input is unparseable', () => {
    expect(formatSatoshisToUSD(100_000_000, 0)).toBe('0.00');
    expect(formatSatoshisToUSD('xyz', 50_000)).toBe('0.00');
  });
});
