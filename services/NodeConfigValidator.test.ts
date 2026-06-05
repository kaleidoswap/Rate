// services/NodeConfigValidator.test.ts
import NodeConfigValidator, { NodeConfig, ValidationResult } from './NodeConfigValidator';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('NodeConfigValidator', () => {
  let validator: NodeConfigValidator;

  beforeEach(() => {
    validator = NodeConfigValidator.getInstance();
    jest.clearAllMocks();
  });

  describe('quickValidate', () => {
    it('should validate correct HTTP URL', () => {
      const config: NodeConfig = {
        apiUrl: 'http://localhost:3001',
      };

      const result = validator.quickValidate(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate correct HTTPS URL', () => {
      const config: NodeConfig = {
        apiUrl: 'https://node.example.com:3001',
      };

      const result = validator.quickValidate(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid URL format', () => {
      const config: NodeConfig = {
        apiUrl: 'not-a-url',
      };

      const result = validator.quickValidate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid URL format');
    });

    it('should reject non-HTTP(S) protocols', () => {
      const config: NodeConfig = {
        apiUrl: 'ftp://localhost:3001',
      };

      const result = validator.quickValidate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('URL must use http or https protocol');
    });

    it('should reject empty URL', () => {
      const config: NodeConfig = {
        apiUrl: '',
      };

      const result = validator.quickValidate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('API URL is required');
    });

    it('should warn about HTTP in production', () => {
      const config: NodeConfig = {
        apiUrl: 'http://remote-server.com:3001',
      };

      const result = validator.quickValidate(config);

      expect(result.warnings).toContainEqual(
        expect.stringContaining('HTTPS is recommended')
      );
    });

    it('should not warn about localhost HTTP', () => {
      const config: NodeConfig = {
        apiUrl: 'http://localhost:3001',
      };

      const result = validator.quickValidate(config);

      expect(result.warnings.some(w => w.includes('HTTPS'))).toBe(false);
    });

    it('should validate with authentication credentials', () => {
      const config: NodeConfig = {
        apiUrl: 'https://node.example.com:3001',
        username: 'admin',
        password: 'secret',
      };

      const result = validator.quickValidate(config);

      expect(result.isValid).toBe(true);
    });

    it('should reject username without password', () => {
      const config: NodeConfig = {
        apiUrl: 'https://node.example.com:3001',
        username: 'admin',
      };

      const result = validator.quickValidate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password required when username is provided');
    });
  });

  describe('testConnection', () => {
    it('should successfully test connection', async () => {
      const config: NodeConfig = {
        apiUrl: 'http://localhost:3001',
      };

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'ok' },
      });

      const result = await validator.testConnection(config, 5000);

      expect(result.success).toBe(true);
      expect(result.responseTime).toBeDefined();
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://localhost:3001/health',
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it('should handle connection timeout', async () => {
      const config: NodeConfig = {
        apiUrl: 'http://localhost:3001',
      };

      mockedAxios.get.mockRejectedValue({
        code: 'ECONNABORTED',
        message: 'timeout',
      });

      const result = await validator.testConnection(config, 5000);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should handle network error', async () => {
      const config: NodeConfig = {
        apiUrl: 'http://localhost:3001',
      };

      mockedAxios.get.mockRejectedValue({
        code: 'ECONNREFUSED',
        message: 'Connection refused',
      });

      const result = await validator.testConnection(config, 5000);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot reach');
    });

    it('should include authentication headers', async () => {
      const config: NodeConfig = {
        apiUrl: 'http://localhost:3001',
        username: 'admin',
        password: 'secret',
      };

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'ok' },
      });

      await validator.testConnection(config, 5000);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://localhost:3001/health',
        expect.objectContaining({
          auth: {
            username: 'admin',
            password: 'secret',
          },
        })
      );
    });

    it('should measure response time', async () => {
      const config: NodeConfig = {
        apiUrl: 'http://localhost:3001',
      };

      mockedAxios.get.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ status: 200, data: {} }), 100)
          )
      );

      const result = await validator.testConnection(config, 5000);

      expect(result.responseTime).toBeGreaterThanOrEqual(100);
      expect(result.responseTime).toBeLessThan(200);
    });
  });

  describe('validateConfig', () => {
    it('should perform full validation with connection test', async () => {
      const config: NodeConfig = {
        apiUrl: 'http://localhost:3001',
      };

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'ok' },
      });

      const result = await validator.validateConfig(config);

      expect(result.isValid).toBe(true);
      expect(result.connectionTest).toBeDefined();
      expect(result.connectionTest?.success).toBe(true);
    });

    it('should fail validation if URL format is invalid', async () => {
      const config: NodeConfig = {
        apiUrl: 'invalid-url',
      };

      const result = await validator.validateConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.connectionTest).toBeUndefined();
    });

    it('should mark as invalid if connection test fails', async () => {
      const config: NodeConfig = {
        apiUrl: 'http://localhost:3001',
      };

      mockedAxios.get.mockRejectedValue(new Error('Connection failed'));

      const result = await validator.validateConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.connectionTest?.success).toBe(false);
    });
  });

  describe('sanitizeUrl', () => {
    it('should remove trailing slash', () => {
      const url = 'http://localhost:3001/';
      const sanitized = validator.sanitizeUrl(url);

      expect(sanitized).toBe('http://localhost:3001');
    });

    it('should remove /api suffix', () => {
      const url = 'http://localhost:3001/api';
      const sanitized = validator.sanitizeUrl(url);

      expect(sanitized).toBe('http://localhost:3001');
    });

    it('should handle multiple trailing slashes', () => {
      const url = 'http://localhost:3001///';
      const sanitized = validator.sanitizeUrl(url);

      expect(sanitized).toBe('http://localhost:3001');
    });

    it('should trim whitespace', () => {
      const url = '  http://localhost:3001  ';
      const sanitized = validator.sanitizeUrl(url);

      expect(sanitized).toBe('http://localhost:3001');
    });

    it('should preserve path if not /api', () => {
      const url = 'http://localhost:3001/custom/path';
      const sanitized = validator.sanitizeUrl(url);

      expect(sanitized).toBe('http://localhost:3001/custom/path');
    });
  });

  describe('findBestConfig', () => {
    it('should return fastest responding config', async () => {
      const configs: NodeConfig[] = [
        { apiUrl: 'http://localhost:3001' },
        { apiUrl: 'http://localhost:3002' },
        { apiUrl: 'http://localhost:3003' },
      ];

      mockedAxios.get
        .mockResolvedValueOnce({
          status: 200,
          data: {},
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ status: 200, data: {} }), 200)
            )
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ status: 200, data: {} }), 100)
            )
        );

      const result = await validator.findBestConfig(configs);

      expect(result).toBeDefined();
      expect(result?.apiUrl).toBe('http://localhost:3001');
    });

    it('should return null if all configs fail', async () => {
      const configs: NodeConfig[] = [
        { apiUrl: 'http://localhost:3001' },
        { apiUrl: 'http://localhost:3002' },
      ];

      mockedAxios.get.mockRejectedValue(new Error('Connection failed'));

      const result = await validator.findBestConfig(configs);

      expect(result).toBeNull();
    });

    it('should skip invalid URL formats', async () => {
      const configs: NodeConfig[] = [
        { apiUrl: 'invalid-url' },
        { apiUrl: 'http://localhost:3001' },
      ];

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: {},
      });

      const result = await validator.findBestConfig(configs);

      expect(result?.apiUrl).toBe('http://localhost:3001');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });
});



