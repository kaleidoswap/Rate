// __tests__/factories/assetFactory.ts

export interface TestAsset {
  id: number;
  asset_id: string;
  name: string;
  ticker: string;
  balance: number;
  total_supply?: number;
  precision: number;
  wallet_id: number;
  contract_id?: string;
  issued_at?: number;
  description?: string;
}

let assetIdCounter = 1;

export const createTestAsset = (overrides: Partial<TestAsset> = {}): TestAsset => {
  const defaults: TestAsset = {
    id: assetIdCounter++,
    asset_id: `rgb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh_${assetIdCounter}`,
    name: `Test Asset ${assetIdCounter}`,
    ticker: `TST${assetIdCounter}`,
    balance: 1000000,
    precision: 8,
    wallet_id: 1,
  };

  return {
    ...defaults,
    ...overrides,
  };
};

export const createUSDTAsset = (overrides: Partial<TestAsset> = {}): TestAsset => {
  return createTestAsset({
    name: 'Tether USD',
    ticker: 'USDT',
    precision: 6,
    total_supply: 1000000000000,
    ...overrides,
  });
};

export const createCustomAsset = (
  name: string,
  ticker: string,
  balance: number,
  overrides: Partial<TestAsset> = {}
): TestAsset => {
  return createTestAsset({
    name,
    ticker,
    balance,
    ...overrides,
  });
};

export const createIssuedAsset = (overrides: Partial<TestAsset> = {}): TestAsset => {
  return createTestAsset({
    total_supply: 10000000,
    issued_at: Date.now(),
    contract_id: `contract_${Date.now()}`,
    description: 'Custom issued asset',
    ...overrides,
  });
};

export const createTestAssets = (count: number): TestAsset[] => {
  return Array.from({ length: count }, (_, i) =>
    createTestAsset({ id: i + 1, ticker: `TST${i + 1}` })
  );
};

export const resetAssetIdCounter = () => {
  assetIdCounter = 1;
};

