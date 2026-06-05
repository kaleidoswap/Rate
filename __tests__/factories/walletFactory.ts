// __tests__/factories/walletFactory.ts

export interface TestWallet {
  id: number;
  name: string;
  type: 'spark' | 'liquid' | 'arkade';
  balance: number;
  network: string;
  created_at: number;
  is_active: boolean;
  mnemonic?: string;
}

let walletIdCounter = 1;

export const createTestWallet = (overrides: Partial<TestWallet> = {}): TestWallet => {
  const defaults: TestWallet = {
    id: walletIdCounter++,
    name: `Test Wallet ${walletIdCounter}`,
    type: 'spark',
    balance: 100000,
    network: 'testnet',
    created_at: Date.now(),
    is_active: true,
  };

  return {
    ...defaults,
    ...overrides,
  };
};

export const createSparkWallet = (overrides: Partial<TestWallet> = {}): TestWallet => {
  return createTestWallet({
    type: 'spark',
    name: 'Spark Wallet',
    ...overrides,
  });
};

export const createLiquidWallet = (overrides: Partial<TestWallet> = {}): TestWallet => {
  return createTestWallet({
    type: 'liquid',
    name: 'Liquid Wallet',
    ...overrides,
  });
};

export const createArkadeWallet = (overrides: Partial<TestWallet> = {}): TestWallet => {
  return createTestWallet({
    type: 'arkade',
    name: 'Arkade Wallet',
    ...overrides,
  });
};

export const createTestWallets = (count: number): TestWallet[] => {
  return Array.from({ length: count }, (_, i) => createTestWallet({ id: i + 1 }));
};

export const resetWalletIdCounter = () => {
  walletIdCounter = 1;
};



