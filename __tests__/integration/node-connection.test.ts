// __tests__/integration/node-connection.test.ts
import RGBApiService from '../../services/RGBApiService';
import NodeConfigValidator from '../../services/NodeConfigValidator';
import ErrorHandlingService from '../../services/ErrorHandlingService';
import { createTestNodeConfig } from '../factories/nodeConfigFactory';
import axios from 'axios';

// Mock dependencies
jest.mock('axios');
jest.mock('../../services/ErrorHandlingService');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Node Connection Integration', () => {
  let rgbApiService: RGBApiService;
  let nodeValidator: NodeConfigValidator;

  beforeEach(() => {
    rgbApiService = RGBApiService.getInstance();
    nodeValidator = NodeConfigValidator.getInstance();
    jest.clearAllMocks();
  });

  describe('Node Initialization with Health Check', () => {
    it('should initialize RGB API service and perform health check', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://localhost:3001',
      });

      // Mock health check response
      mockedAxios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          status: 'ok',
          version: '1.0.0',
          uptime: 3600,
        },
      });

      // Initialize service
      rgbApiService.initialize(nodeConfig.apiUrl);

      // Perform health check
      const healthCheck = await rgbApiService.checkNodeHealth();

      expect(healthCheck.healthy).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/health'),
        expect.any(Object)
      );
    });

    it('should detect unhealthy node', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://localhost:3001',
      });

      // Mock failed health check
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('Connection refused'));

      rgbApiService.initialize(nodeConfig.apiUrl);

      const healthCheck = await rgbApiService.checkNodeHealth();

      expect(healthCheck.healthy).toBe(false);
      expect(healthCheck.error).toBeDefined();
    });

    it('should validate node configuration before initialization', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://localhost:3001',
      });

      mockedAxios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { status: 'ok' },
      });

      // Validate configuration
      const validation = await nodeValidator.validateConfig(nodeConfig);

      expect(validation.isValid).toBe(true);
      expect(validation.connectionTest?.success).toBe(true);
    });
  });

  describe('Graceful Failure Handling', () => {
    it('should handle connection timeout gracefully', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://localhost:3001',
        timeout: 2000,
      });

      // Mock timeout error
      mockedAxios.get = jest.fn().mockRejectedValue({
        code: 'ECONNABORTED',
        message: 'timeout of 2000ms exceeded',
      });

      const connectionTest = await nodeValidator.testConnection(nodeConfig, 2000);

      expect(connectionTest.success).toBe(false);
      expect(connectionTest.error).toContain('timeout');
    });

    it('should handle network unavailable error', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://localhost:3001',
      });

      // Mock network error
      mockedAxios.get = jest.fn().mockRejectedValue({
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:3001',
      });

      const connectionTest = await nodeValidator.testConnection(nodeConfig, 5000);

      expect(connectionTest.success).toBe(false);
      expect(connectionTest.error).toContain('Cannot reach');
    });

    it('should continue app operation with degraded functionality', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://localhost:3001',
      });

      // Mock connection failure
      mockedAxios.get = jest.fn().mockRejectedValue(
        new Error('Node unavailable')
      );

      rgbApiService.initialize(nodeConfig.apiUrl);

      // App should handle this gracefully
      const healthCheck = await rgbApiService.checkNodeHealth();

      expect(healthCheck.healthy).toBe(false);
      // App can continue with limited functionality
      expect(rgbApiService).toBeDefined();
    });

    it('should provide user-friendly error messages', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://localhost:3001',
      });

      mockedAxios.get = jest.fn().mockRejectedValue(
        new Error('Network request failed')
      );

      const connectionTest = await nodeValidator.testConnection(nodeConfig, 5000);

      expect(connectionTest.success).toBe(false);
      expect(connectionTest.error).toBeTruthy();
      // Error should be user-friendly
      expect(typeof connectionTest.error).toBe('string');
    });
  });

  describe('Connection Retry Logic', () => {
    it('should retry failed connections', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://localhost:3001',
        maxRetries: 3,
      });

      // Mock: fail twice, then succeed
      mockedAxios.get = jest.fn()
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({
          status: 200,
          data: { status: 'ok' },
        });

      rgbApiService.initialize(nodeConfig.apiUrl);

      // The service should retry internally
      const healthCheck = await rgbApiService.checkNodeHealth();

      expect(healthCheck.healthy).toBe(true);
    });

    it('should fail after max retries exceeded', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://localhost:3001',
        maxRetries: 3,
      });

      // Mock: always fail
      mockedAxios.get = jest.fn().mockRejectedValue(
        new Error('Connection failed')
      );

      const connectionTest = await nodeValidator.testConnection(nodeConfig, 5000);

      expect(connectionTest.success).toBe(false);
    });
  });

  describe('Multiple Node Configurations', () => {
    it('should find best available node from multiple configs', async () => {
      const configs = [
        createTestNodeConfig({ apiUrl: 'http://localhost:3001' }),
        createTestNodeConfig({ apiUrl: 'http://localhost:3002' }),
        createTestNodeConfig({ apiUrl: 'http://localhost:3003' }),
      ];

      // Mock: first fails, second succeeds, third succeeds slower
      mockedAxios.get = jest.fn()
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ status: 200, data: {} })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ status: 200, data: {} }), 200)
            )
        );

      const bestConfig = await nodeValidator.findBestConfig(configs);

      expect(bestConfig).toBeDefined();
      expect(bestConfig?.apiUrl).toBe('http://localhost:3002');
    });

    it('should return null if all configs fail', async () => {
      const configs = [
        createTestNodeConfig({ apiUrl: 'http://localhost:3001' }),
        createTestNodeConfig({ apiUrl: 'http://localhost:3002' }),
      ];

      // Mock: all fail
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('Failed'));

      const bestConfig = await nodeValidator.findBestConfig(configs);

      expect(bestConfig).toBeNull();
    });
  });

  describe('Secure Connection', () => {
    it('should use HTTPS for remote nodes', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'https://node.example.com:3001',
      });

      const validation = nodeValidator.quickValidate(nodeConfig);

      expect(validation.isValid).toBe(true);
      expect(nodeConfig.apiUrl).toContain('https');
    });

    it('should warn about HTTP for remote nodes', () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'http://remote-server.com:3001',
      });

      const validation = nodeValidator.quickValidate(nodeConfig);

      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warnings.some(w => w.includes('HTTPS'))).toBe(true);
    });

    it('should support authenticated connections', async () => {
      const nodeConfig = createTestNodeConfig({
        apiUrl: 'https://node.example.com:3001',
        username: 'admin',
        password: 'secret',
      });

      mockedAxios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { status: 'ok' },
      });

      await nodeValidator.testConnection(nodeConfig, 5000);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          auth: {
            username: 'admin',
            password: 'secret',
          },
        })
      );
    });
  });

  describe('Node Status Monitoring', () => {
    it('should periodically check node health', async () => {
      const nodeConfig = createTestNodeConfig();

      let callCount = 0;
      mockedAxios.get = jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          status: 200,
          data: { status: 'ok', uptime: callCount * 1000 },
        });
      });

      rgbApiService.initialize(nodeConfig.apiUrl);

      // Check health multiple times
      await rgbApiService.checkNodeHealth();
      await rgbApiService.checkNodeHealth();
      await rgbApiService.checkNodeHealth();

      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it('should detect when node becomes unhealthy', async () => {
      const nodeConfig = createTestNodeConfig();

      rgbApiService.initialize(nodeConfig.apiUrl);

      // First check: healthy
      mockedAxios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { status: 'ok' },
      });

      let healthCheck = await rgbApiService.checkNodeHealth();
      expect(healthCheck.healthy).toBe(true);

      // Second check: unhealthy
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('Node crashed'));

      healthCheck = await rgbApiService.checkNodeHealth();
      expect(healthCheck.healthy).toBe(false);
    });
  });

  describe('URL Sanitization', () => {
    it('should sanitize node URLs correctly', () => {
      const tests = [
        { input: 'http://localhost:3001/', expected: 'http://localhost:3001' },
        { input: 'http://localhost:3001/api', expected: 'http://localhost:3001' },
        { input: '  http://localhost:3001  ', expected: 'http://localhost:3001' },
        { input: 'http://localhost:3001///', expected: 'http://localhost:3001' },
      ];

      tests.forEach(({ input, expected }) => {
        const sanitized = nodeValidator.sanitizeUrl(input);
        expect(sanitized).toBe(expected);
      });
    });
  });

  describe('Connection Response Time', () => {
    it('should measure connection response time', async () => {
      const nodeConfig = createTestNodeConfig();

      mockedAxios.get = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ status: 200, data: {} }), 100)
          )
      );

      const connectionTest = await nodeValidator.testConnection(nodeConfig, 5000);

      expect(connectionTest.responseTime).toBeGreaterThanOrEqual(100);
      expect(connectionTest.responseTime).toBeLessThan(200);
    });

    it('should prefer faster nodes', async () => {
      const configs = [
        createTestNodeConfig({ apiUrl: 'http://slow.example.com' }),
        createTestNodeConfig({ apiUrl: 'http://fast.example.com' }),
      ];

      mockedAxios.get = jest.fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ status: 200, data: {} }), 300)
            )
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ status: 200, data: {} }), 50)
            )
        );

      const bestConfig = await nodeValidator.findBestConfig(configs);

      expect(bestConfig?.apiUrl).toBe('http://fast.example.com');
    });
  });
});



