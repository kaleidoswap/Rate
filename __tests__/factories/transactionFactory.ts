// __tests__/factories/transactionFactory.ts

export interface TestTransaction {
  id: number;
  txid: string;
  wallet_id: number;
  type: 'send' | 'receive';
  amount: number;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  description?: string;
  address?: string;
  invoice?: string;
  fee?: number;
  confirmations?: number;
  asset_id?: string;
}

let txIdCounter = 1;

export const createTestTransaction = (
  overrides: Partial<TestTransaction> = {}
): TestTransaction => {
  const defaults: TestTransaction = {
    id: txIdCounter++,
    txid: `tx_${Date.now()}_${txIdCounter}`,
    wallet_id: 1,
    type: 'send',
    amount: 10000,
    status: 'confirmed',
    timestamp: Date.now(),
  };

  return {
    ...defaults,
    ...overrides,
  };
};

export const createPendingTransaction = (
  overrides: Partial<TestTransaction> = {}
): TestTransaction => {
  return createTestTransaction({
    status: 'pending',
    confirmations: 0,
    ...overrides,
  });
};

export const createConfirmedTransaction = (
  overrides: Partial<TestTransaction> = {}
): TestTransaction => {
  return createTestTransaction({
    status: 'confirmed',
    confirmations: 6,
    ...overrides,
  });
};

export const createFailedTransaction = (
  overrides: Partial<TestTransaction> = {}
): TestTransaction => {
  return createTestTransaction({
    status: 'failed',
    ...overrides,
  });
};

export const createSendTransaction = (
  overrides: Partial<TestTransaction> = {}
): TestTransaction => {
  return createTestTransaction({
    type: 'send',
    address: 'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    ...overrides,
  });
};

export const createReceiveTransaction = (
  overrides: Partial<TestTransaction> = {}
): TestTransaction => {
  return createTestTransaction({
    type: 'receive',
    ...overrides,
  });
};

export const createLightningTransaction = (
  overrides: Partial<TestTransaction> = {}
): TestTransaction => {
  return createTestTransaction({
    invoice: 'lnbc100n1pj9....',
    description: 'Lightning payment',
    ...overrides,
  });
};

export const createRGBTransaction = (
  overrides: Partial<TestTransaction> = {}
): TestTransaction => {
  return createTestTransaction({
    asset_id: 'rgb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    description: 'RGB asset transfer',
    ...overrides,
  });
};

export const createTestTransactions = (count: number): TestTransaction[] => {
  return Array.from({ length: count }, (_, i) =>
    createTestTransaction({ id: i + 1, txid: `tx_${i + 1}` })
  );
};

export const resetTransactionIdCounter = () => {
  txIdCounter = 1;
};



