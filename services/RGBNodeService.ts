// services/RGBNodeService.ts
import * as FileSystem from 'expo-file-system';
import { Platform, NativeModules } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

// Background task name for the RGB node
const RGB_NODE_TASK = 'RGB_NODE_BACKGROUND_TASK';

// Get the native module with fallback for development
const RGBNode = NativeModules.RGBNode || {
  startNode: async () => ({ success: true, daemon_port: 3000, ldk_peer_port: 9735 }),
  stopNode: async () => ({ success: true }),
  isNodeRunning: async () => ({ isRunning: true }),
};

interface NodeConfig {
  dataDir: string;
  network: 'mainnet' | 'testnet' | 'regtest' | 'signet';
  daemonListeningPort: number;
  ldkPeerListeningPort: number;
  nodeType: 'local' | 'remote';
  remoteNodeUrl?: string;
}

interface NodeStatus {
  isRunning: boolean;
  daemonPort: number;
  ldkPeerPort: number;
  error?: string;
}

// Define the background task for RGB node operations
TaskManager.defineTask(RGB_NODE_TASK, async () => {
  try {
    console.log('Background RGB Lightning Node task executed');
    const nodeService = RGBNodeService.getInstance();
    const isHealthy = await nodeService.checkNodeHealth();
    
    if (!isHealthy) {
      console.warn('Node health check failed, attempting restart...');
      await nodeService.restartNode();
    }
    
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('Background RGB Lightning Node task failed:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export class RGBNodeService {
  private static instance: RGBNodeService;
  private isRunning = false;
  private readonly DAEMON_PORT = 3008;
  private readonly LDK_PEER_PORT = 9738;
  private nodeConfig: NodeConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.nodeConfig = {
      dataDir: FileSystem.documentDirectory ? `${FileSystem.documentDirectory}rgb-data/` : '/tmp/rgb-data/',
      network: 'regtest',
      daemonListeningPort: this.DAEMON_PORT,
      ldkPeerListeningPort: this.LDK_PEER_PORT,
      nodeType: 'remote',
      remoteNodeUrl: 'https://node-api.thunderstack.org/c1cb65e0-b071-7027-7994-ecad2c46d5ec/efa615e2a9ad4ca4a3f7e8203d73fce3'
    };
  }

  public static getInstance(): RGBNodeService {
    if (!RGBNodeService.instance) {
      RGBNodeService.instance = new RGBNodeService();
    }
    return RGBNodeService.instance;
  }

  /**
   * Initialize the RGB node
   */
  async initializeNode(): Promise<boolean> {
    try {
      if (this.nodeConfig.nodeType === 'remote') {
        // For remote node, verify the connection with retries
        let retries = 3;
        let lastError: Error | null = null;

        while (retries > 0) {
          try {
            // Use AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${this.nodeConfig.remoteNodeUrl}/nodeinfo`, {
              signal: controller.signal
            });

            clearTimeout(timeoutId);
            
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Remote node connection successful:', data);
            
            this.isRunning = true;
            return true;
          } catch (error) {
            lastError = error as Error;
            retries--;
            if (retries > 0) {
              // Wait 1 second before retrying
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }

        // If we get here, all retries failed
        console.error('Failed to connect to remote node after retries:', lastError);
        throw new Error(`Failed to connect to remote node: ${lastError?.message}`);
      }

      // Local node initialization logic
      console.log('Initializing local node...');
      const dataDir = this.nodeConfig.dataDir;
      await FileSystem.makeDirectoryAsync(dataDir, { intermediates: true });

      // Write config file
      const configPath = `${dataDir}config.json`;
      const config = {
        daemon_listening_port: this.nodeConfig.daemonListeningPort,
        ldk_peer_listening_port: this.nodeConfig.ldkPeerListeningPort,
        data_dir: dataDir,
        network: this.nodeConfig.network,
      };

      await FileSystem.writeAsStringAsync(
        configPath,
        JSON.stringify(config, null, 2)
      );

      // Start local node process
      const result = await RGBNode.startNode({
        network: this.nodeConfig.network,
        daemon_listening_port: this.nodeConfig.daemonListeningPort,
        ldk_peer_listening_port: this.nodeConfig.ldkPeerListeningPort,
      }).catch((error: Error) => {
        throw new Error(`Failed to start RGB Lightning Node: ${error.message}`);
      });

      if (!result || !result.success) {
        throw new Error('Failed to start RGB Lightning Node: No success response');
      }

      this.isRunning = true;

      // Register background task for node operations
      if (Platform.OS !== 'web') {
        try {
          await BackgroundTask.registerTaskAsync(RGB_NODE_TASK, {
            minimumInterval: 15 * 60, // 15 minutes minimum interval
          });
        } catch (error) {
          console.warn('Failed to register background task:', error);
          // Continue even if background task registration fails
        }
      }

      // Start health check interval
      this.startHealthCheck();

      return true;
    } catch (error) {
      console.error('Failed to initialize node:', error);
      return false;
    }
  }

  /**
   * Start the RGB Lightning Node
   */
  async startNode(): Promise<NodeStatus> {
    if (this.isRunning) {
      return {
        isRunning: true,
        daemonPort: this.nodeConfig.daemonListeningPort,
        ldkPeerPort: this.nodeConfig.ldkPeerListeningPort,
      };
    }

    try {
      // Initialize node if not already done
      const initialized = await this.initializeNode();
      if (!initialized) {
        throw new Error('Failed to initialize node');
      }

      // Start the native node process
      const result = await RGBNode.startNode({
        network: this.nodeConfig.network,
        daemon_listening_port: this.nodeConfig.daemonListeningPort,
        ldk_peer_listening_port: this.nodeConfig.ldkPeerListeningPort,
      }).catch((error: Error) => {
        throw new Error(`Failed to start RGB Lightning Node: ${error.message}`);
      });

      if (!result || !result.success) {
        throw new Error('Failed to start RGB Lightning Node: No success response');
      }

      this.isRunning = true;

      // Register background task for node operations
      if (Platform.OS !== 'web') {
        try {
          await BackgroundTask.registerTaskAsync(RGB_NODE_TASK, {
            minimumInterval: 15 * 60, // 15 minutes minimum interval
          });
        } catch (error) {
          console.warn('Failed to register background task:', error);
          // Continue even if background task registration fails
        }
      }

      // Start health check interval
      this.startHealthCheck();

      return {
        isRunning: true,
        daemonPort: result.daemon_port,
        ldkPeerPort: result.ldk_peer_port,
      };
    } catch (error) {
      console.error('Failed to start RGB Lightning Node:', error instanceof Error ? error.message : String(error));
      this.isRunning = false;
      return {
        isRunning: false,
        daemonPort: this.nodeConfig.daemonListeningPort,
        ldkPeerPort: this.nodeConfig.ldkPeerListeningPort,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Stop the RGB Lightning Node
   */
  async stopNode(): Promise<boolean> {
    try {
      // Stop health check
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Stop the native node process
      await RGBNode.stopNode().catch((error: Error) => {
        throw new Error(`Failed to stop RGB Lightning Node: ${error.message}`);
      });
      
      this.isRunning = false;

      // Unregister background task
      if (Platform.OS !== 'web') {
        try {
          await BackgroundTask.unregisterTaskAsync(RGB_NODE_TASK);
        } catch (error) {
          console.warn('Failed to unregister background task:', error);
          // Continue even if background task unregistration fails
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to stop RGB Lightning Node:', error);
      return false;
    }
  }

  /**
   * Check if the RGB Lightning Node is healthy
   */
  async checkNodeHealth(): Promise<boolean> {
    if (!this.isRunning) {
      return false;
    }

    try {
      const status = await RGBNode.isNodeRunning().catch((error: Error) => {
        throw new Error(`Failed to check RGB Lightning Node status: ${error.message}`);
      });
      return status.isRunning;
    } catch (error) {
      console.warn('Node health check failed:', error);
      return false;
    }
  }

  /**
   * Get current node status
   */
  getNodeStatus(): NodeStatus {
    return {
      isRunning: this.isRunning,
      daemonPort: this.nodeConfig.daemonListeningPort,
      ldkPeerPort: this.nodeConfig.ldkPeerListeningPort,
    };
  }

  /**
   * Restart the node
   */
  async restartNode(): Promise<NodeStatus> {
    console.log('Restarting RGB Lightning Node...');
    await this.stopNode();
    await this.delay(1000);
    return await this.startNode();
  }

  /**
   * Get node configuration
   */
  getNodeConfig(): NodeConfig {
    return { ...this.nodeConfig };
  }

  /**
   * Update node configuration
   */
  async updateNodeConfig(newConfig: Partial<NodeConfig>): Promise<boolean> {
    try {
      this.nodeConfig = { ...this.nodeConfig, ...newConfig };
      
      // Write updated config to file
      const configPath = `${this.nodeConfig.dataDir}config.json`;
      const config = {
        daemon_listening_port: this.nodeConfig.daemonListeningPort,
        ldk_peer_listening_port: this.nodeConfig.ldkPeerListeningPort,
        data_dir: this.nodeConfig.dataDir,
        network: this.nodeConfig.network,
      };

      await FileSystem.writeAsStringAsync(
        configPath,
        JSON.stringify(config, null, 2)
      );

      return true;
    } catch (error) {
      console.error('Failed to update node config:', error);
      return false;
    }
  }

  /**
   * Make an API request to the node
   */
  async makeNodeRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    try {
      const baseUrl = this.nodeConfig.nodeType === 'remote' 
        ? this.nodeConfig.remoteNodeUrl 
        : `http://localhost:${this.nodeConfig.daemonListeningPort}`;

      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${baseUrl}/${endpoint.replace(/^\//, '')}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Node request failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Node request failed:', error);
      throw error;
    }
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      const isHealthy = await this.checkNodeHealth();
      if (!isHealthy) {
        console.warn('RGB Lightning Node health check failed');
      }
    }, 30000); // Check every 30 seconds
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default RGBNodeService;