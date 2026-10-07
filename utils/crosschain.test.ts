import { detectCrossChainAddress, isValidRecipientForFamily } from './crosschain';
import {
  describeOrchestraFee,
  formatSmallUnits,
  fromFixedDecimalUnits,
  routeHops,
  toChecksumAddress,
  toFixedDecimalUnits,
} from './orchestra-ui';

const CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

describe('crosschain address detection', () => {
  it('checksums an all-lowercase EVM address', () => {
    expect(detectCrossChainAddress(CHECKSUMMED.toLowerCase())).toEqual({ family: 'evm', normalized: CHECKSUMMED });
    expect(toChecksumAddress(CHECKSUMMED.toLowerCase())).toBe(CHECKSUMMED);
  });

  it('rejects a mixed-case EVM address with a bad checksum', () => {
    const typo = CHECKSUMMED.replace('aA', 'Aa');
    expect(detectCrossChainAddress(typo)).toBeNull();
    expect(isValidRecipientForFamily(typo, 'evm')).toBe(false);
  });

  it('accepts a 32-byte Solana key and rejects a short one', () => {
    const sol = 'So11111111111111111111111111111111111111112';
    expect(detectCrossChainAddress(sol)?.family).toBe('solana');
    expect(detectCrossChainAddress('So1111111111111111111111111111111')).toBeNull();
  });

  it('ignores wallet-native destinations', () => {
    expect(detectCrossChainAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBeNull();
    expect(detectCrossChainAddress('')).toBeNull();
  });
});

describe('orchestra amounts and fees', () => {
  it('round-trips decimal amounts without float error', () => {
    expect(toFixedDecimalUnits('1.5', 6)).toBe('1500000');
    expect(toFixedDecimalUnits('0.1', 18)).toBe('100000000000000000');
    expect(toFixedDecimalUnits('abc', 6)).toBe('0');
    expect(fromFixedDecimalUnits('1500000', 6)).toBe('1.5');
    expect(fromFixedDecimalUnits('1', 8)).toBe('0.00000001');
    expect(formatSmallUnits('1234567890', 6)).toBe('1,234.56789');
  });

  it('derives the fee share from real amounts, not feeBps', () => {
    const fee = describeOrchestraFee(
      { totalFeeAmount: '10000', feeAsset: 'USDC', feeBps: 10 },
      { sourceAmountRaw: '2000000', sourceAsset: 'USDT' },
    );
    expect(fee?.text).toBe('0.01 USDC (~0.5%)');
    expect(fee?.note).toContain('USDC');
    expect(describeOrchestraFee({ totalFeeAmount: '0' })).toBeNull();
  });

  it('reads hops from both route shapes', () => {
    expect(routeHops(['USDT', 'USDC', 'BTC'])).toEqual(['USDT', 'USDC', 'BTC']);
    expect(routeHops({ sourceAsset: 'USDT', destinationAsset: 'BTC' })).toEqual(['USDT', 'BTC']);
    expect(routeHops(null)).toEqual([]);
  });
});
