// __tests__/factories/nodeConfigFactory.ts

export interface TestNodeConfig {
  apiUrl: string;
  username?: string;
  password?: string;
  timeout?: number;
  maxRetries?: number;
}

export const createTestNodeConfig = (
  overrides: Partial<TestNodeConfig> = {}
): TestNodeConfig => {
  const defaults: TestNodeConfig = {
    apiUrl: 'http://localhost:3001',
    timeout: 5000,
    maxRetries: 3,
  };

  return {
    ...defaults,
    ...overrides,
  };
};

export const createLocalNodeConfig = (
  port: number = 3001,
  overrides: Partial<TestNodeConfig> = {}
): TestNodeConfig => {
  return createTestNodeConfig({
    apiUrl: `http://localhost:${port}`,
    ...overrides,
  });
};

export const createRemoteNodeConfig = (
  host: string,
  overrides: Partial<TestNodeConfig> = {}
): TestNodeConfig => {
  return createTestNodeConfig({
    apiUrl: `https://${host}`,
    ...overrides,
  });
};

export const createAuthenticatedNodeConfig = (
  overrides: Partial<TestNodeConfig> = {}
): TestNodeConfig => {
  return createTestNodeConfig({
    username: 'admin',
    password: 'secret123',
    ...overrides,
  });
};

export const createHttpsNodeConfig = (
  overrides: Partial<TestNodeConfig> = {}
): TestNodeConfig => {
  return createTestNodeConfig({
    apiUrl: 'https://node.example.com:3001',
    ...overrides,
  });
};

export const createTestNodeConfigs = (count: number): TestNodeConfig[] => {
  return Array.from({ length: count }, (_, i) =>
    createTestNodeConfig({ apiUrl: `http://localhost:${3001 + i}` })
  );
};

