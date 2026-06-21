// __tests__/swap-flashnet.test.ts
// Unit coverage for the Flashnet / USDB swap helpers.
import {
  BTC_ASSET_PUBKEY,
  USDB_TOKEN_ADDRESS,
  USDB_TOKEN_ADDRESS_ALIASES,
  USDB_DECIMALS,
  getFlashnetNetworkForSpark,
  getUsdbRewardRate,
  isUsdbTokenAddress,
} from '../utils/flashnet';
import { buildFlashnetPairs, createFlashnetPairAsset } from '../utils/swap-model';

describe('flashnet constants & helpers', () => {
  it('detects USDB across address aliases (case-insensitive)', () => {
    expect(isUsdbTokenAddress(USDB_TOKEN_ADDRESS.mainnet)).toBe(true);
    expect(isUsdbTokenAddress(USDB_TOKEN_ADDRESS_ALIASES[1])).toBe(true);
    expect(isUsdbTokenAddress(USDB_TOKEN_ADDRESS.mainnet.toUpperCase())).toBe(true);
    expect(isUsdbTokenAddress('btkn1notusdb')).toBe(false);
    expect(isUsdbTokenAddress(null)).toBe(false);
    expect(isUsdbTokenAddress(undefined)).toBe(false);
  });

  it('normalizes Spark network names', () => {
    expect(getFlashnetNetworkForSpark('MAINNET')).toBe('mainnet');
    expect(getFlashnetNetworkForSpark(' regtest ')).toBe('regtest');
    expect(getFlashnetNetworkForSpark('signet')).toBeNull();
    expect(getFlashnetNetworkForSpark(undefined)).toBeNull();
  });

  it('returns the correct USDB staking reward tier', () => {
    expect(getUsdbRewardRate(0)).toBe(0);
    expect(getUsdbRewardRate(9)).toBe(0);
    expect(getUsdbRewardRate(10)).toBe(0.035);
    expect(getUsdbRewardRate(1_000)).toBe(0.045);
    expect(getUsdbRewardRate(50_000)).toBe(0.06);
  });
});

describe('createFlashnetPairAsset', () => {
  it('resolves the BTC sentinel pubkey to BTC on Spark', () => {
    const asset = createFlashnetPairAsset(BTC_ASSET_PUBKEY);
    expect(asset.ticker).toBe('BTC');
    expect(asset.precision).toBe(8);
    expect(asset.protocol_ids.SPARK).toBe(BTC_ASSET_PUBKEY);
  });

  it('resolves the USDB address to canonical USDB metadata', () => {
    const asset = createFlashnetPairAsset(USDB_TOKEN_ADDRESS.mainnet);
    expect(asset.ticker).toBe('USDB');
    expect(asset.name).toBe('Spark USD Balance');
    expect(asset.precision).toBe(USDB_DECIMALS);
    // protocol_ids must stay the raw pool address (AMM expects it verbatim).
    expect(asset.protocol_ids.SPARK).toBe(USDB_TOKEN_ADDRESS.mainnet);
  });

  it('resolves USDB from a hex pool address via its bech32m bridge', () => {
    // listPools returns hex pubkeys; the bech32m form (from encodeTokenAddress)
    // is what identifies USDB. protocol_ids must stay the raw hex address.
    const hexAddr = '03deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb';
    const asset = createFlashnetPairAsset(hexAddr, [], { bech32Address: USDB_TOKEN_ADDRESS.mainnet });
    expect(asset.ticker).toBe('USDB');
    expect(asset.precision).toBe(USDB_DECIMALS);
    expect(asset.protocol_ids.SPARK).toBe(hexAddr);
  });

  it('prefers a held wallet inventory match', () => {
    const inventory = [{ asset_id: 'btkn1somehex', ticker: 'TEST', name: 'Test Token', precision: 4 }];
    const asset = createFlashnetPairAsset('btkn1somehex', inventory);
    expect(asset.ticker).toBe('TEST');
    expect(asset.precision).toBe(4);
    expect(asset.protocol_ids.SPARK).toBe('btkn1somehex');
  });

  it('falls back to pool metadata then a shortened address', () => {
    const withSymbol = createFlashnetPairAsset('btkn1abcdef0000000000xyz', [], { symbol: 'foo', precision: 2 });
    expect(withSymbol.ticker).toBe('FOO');
    expect(withSymbol.precision).toBe(2);

    const bare = createFlashnetPairAsset('btkn1abcdef0000000000xyz');
    expect(bare.ticker).toContain('…');
    expect(bare.protocol).toBe('SPARK');
  });
});

describe('buildFlashnetPairs', () => {
  it('builds a BTC/USDB pair from a raw AMM pool payload', () => {
    const pools = [
      {
        lpPublicKey: 'lp_pub_1',
        assetAAddress: BTC_ASSET_PUBKEY,
        assetBAddress: USDB_TOKEN_ADDRESS.mainnet,
        assetAReserve: '100000',
        assetBReserve: '5000000',
      },
    ];
    const pairs = buildFlashnetPairs(pools);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].venue).toBe('flashnet');
    expect(pairs[0].poolId).toBe('lp_pub_1');
    expect(pairs[0].base.ticker).toBe('BTC');
    expect(pairs[0].quote.ticker).toBe('USDB');
    expect(pairs[0].quote.precision).toBe(USDB_DECIMALS);
  });

  it('handles an empty / missing pool list', () => {
    expect(buildFlashnetPairs([])).toEqual([]);
    expect(buildFlashnetPairs(undefined as any)).toEqual([]);
  });
});
