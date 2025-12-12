// services/NodeConfigValidator.ts
import axios from 'axios';

export interface NodeConfig {
  type: 'local' | 'remote';
  url?: string;
  port?: number;
  timeout?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  nodeInfo?: any;
}

export class NodeConfigValidator {
  private static instance: NodeConfigValidator;

  private constructor() {}

  public static getInstance(): NodeConfigValidator {
    if (!NodeConfigValidator.instance) {
      NodeConfigValidator.instance = new NodeConfigValidator();
    }
    return NodeConfigValidator.instance;
  }

  /**
   * Validate node configuration
   */
  async validateConfig(config: NodeConfig): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // Validate configuration structure
    this.validateStructure(config, result);

    // If structure is valid, test connection
    if (result.valid && config.type === 'remote' && config.url) {
      await this.testConnection(config, result);
    }

    // Set final validity
    result.valid = result.errors.length === 0;

    return result;
  }

  /**
   * Validate configuration structure
   */
  private validateStructure(config: NodeConfig, result: ValidationResult): void {
    // Check type
    if (!config.type || !['local', 'remote'].includes(config.type)) {
      result.errors.push('Invalid node type. Must be "local" or "remote"');
      return;
    }

    // Validate remote configuration
    if (config.type === 'remote') {
      if (!config.url) {
        result.errors.push('Remote node URL is required');
        return;
      }

      // Validate URL format
      if (!this.isValidUrl(config.url)) {
        result.errors.push('Invalid URL format. Must start with http:// or https://');
        return;
      }

      // Check for localhost/private IPs in production
      if (this.isLocalhost(config.url)) {
        result.warnings.push('Using localhost URL. This will only work in development');
      }

      // Check for HTTPS in production
      if (!config.url.startsWith('https://') && !this.isLocalhost(config.url)) {
        result.warnings.push('Using HTTP instead of HTTPS. This is not secure for production');
      }
    }

    // Validate port
    if (config.port !== undefined) {
      if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
        result.errors.push('Invalid port number. Must be between 1 and 65535');
      }
    }

    // Validate timeout
    if (config.timeout !== undefined) {
      if (!Number.isInteger(config.timeout) || config.timeout < 1000) {
        result.warnings.push('Timeout should be at least 1000ms for reliable connections');
      }
    }
  }

  /**
   * Test connection to node
   */
  private async testConnection(config: NodeConfig, result: ValidationResult): Promise<void> {
    try {
      const url = config.url!;
      const timeout = config.timeout || 10000;

      console.log(`Testing connection to ${url}...`);

      // Try to get node info
      const response = await axios.get(`${url}/nodeinfo`, {
        timeout,
        validateStatus: (status) => status < 500, // Accept any status < 500
      });

      if (response.status === 200) {
        result.nodeInfo = response.data;
        console.log('Connection successful:', response.data);
      } else if (response.status === 401 || response.status === 403) {
        result.warnings.push('Node requires authentication. Make sure you have the correct credentials');
      } else if (response.status === 404) {
        result.warnings.push('Node endpoint not found. The node might not be properly configured');
      } else {
        result.warnings.push(`Unexpected response status: ${response.status}`);
      }
    } catch (error: any) {
      console.error('Connection test failed:', error);

      if (error.code === 'ECONNREFUSED') {
        result.errors.push('Connection refused. The node is not running or not accessible');
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        result.errors.push('Connection timeout. The node is not responding or network is slow');
      } else if (error.code === 'ENOTFOUND') {
        result.errors.push('Host not found. Check the URL and your internet connection');
      } else if (error.code === 'ECONNRESET') {
        result.errors.push('Connection reset. The node closed the connection');
      } else if (error.message?.includes('Network Error')) {
        result.errors.push('Network error. Check your internet connection');
      } else {
        result.warnings.push(`Connection test failed: ${error.message || 'Unknown error'}`);
      }
    }
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Check if URL is localhost
   */
  private isLocalhost(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')
      );
    } catch {
      return false;
    }
  }

  /**
   * Quick validation (structure only, no connection test)
   */
  async quickValidate(config: NodeConfig): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    this.validateStructure(config, result);
    result.valid = result.errors.length === 0;

    return result;
  }

  /**
   * Get recommended configuration
   */
  getRecommendedConfig(type: 'local' | 'remote'): NodeConfig {
    if (type === 'local') {
      return {
        type: 'local',
        url: 'http://127.0.0.1:3000',
        port: 3000,
        timeout: 30000,
      };
    } else {
      return {
        type: 'remote',
        url: '', // User must provide
        timeout: 30000,
      };
    }
  }

  /**
   * Sanitize URL (remove trailing slash, etc.)
   */
  sanitizeUrl(url: string): string {
    let sanitized = url.trim();
    
    // Remove trailing slash
    if (sanitized.endsWith('/')) {
      sanitized = sanitized.slice(0, -1);
    }
    
    // Ensure protocol
    if (!sanitized.startsWith('http://') && !sanitized.startsWith('https://')) {
      // Default to https for non-localhost
      if (this.isLocalhost(sanitized)) {
        sanitized = `http://${sanitized}`;
      } else {
        sanitized = `https://${sanitized}`;
      }
    }
    
    return sanitized;
  }

  /**
   * Parse configuration from string
   */
  parseConfigString(configString: string): NodeConfig | null {
    try {
      const config = JSON.parse(configString);
      
      // Validate required fields
      if (!config.type) {
        return null;
      }
      
      return config as NodeConfig;
    } catch {
      return null;
    }
  }

  /**
   * Test multiple configurations and return the best one
   */
  async findBestConfig(configs: NodeConfig[]): Promise<NodeConfig | null> {
    const results = await Promise.all(
      configs.map(async (config) => ({
        config,
        validation: await this.validateConfig(config),
      }))
    );

    // Find first valid config with no errors
    const validConfig = results.find(r => r.validation.valid && r.validation.errors.length === 0);
    
    if (validConfig) {
      return validConfig.config;
    }

    // Find config with least errors
    const sortedResults = results.sort((a, b) => 
      a.validation.errors.length - b.validation.errors.length
    );

    return sortedResults[0]?.config || null;
  }

  /**
   * Get common error solutions
   */
  getErrorSolution(error: string): string {
    if (error.includes('Connection refused')) {
      return 'Make sure the RGB node is running and the URL/port are correct. Try starting the node service.';
    } else if (error.includes('timeout')) {
      return 'The node is not responding. Check if it\'s running and your network connection is stable.';
    } else if (error.includes('not found')) {
      return 'Check the URL and make sure you can reach the server. Verify your DNS settings.';
    } else if (error.includes('authentication')) {
      return 'The node requires authentication. Check your credentials and permissions.';
    } else if (error.includes('Network error')) {
      return 'Check your internet connection and firewall settings.';
    } else {
      return 'Try restarting the node or contact your node provider for support.';
    }
  }
}

export default NodeConfigValidator;



