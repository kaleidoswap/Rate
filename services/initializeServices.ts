// services/initializeServices.ts
import { getStore } from '../store/storeProvider';
import { createApiInstance, getApiInstance } from './apiInstance';
import RGBApiService from './RGBApiService';
import { RGBNodeService } from './RGBNodeService';
import NostrService from './NostrService';
import NWCService from './NWCService';
import { restoreNostrConnection, loadKeysSecurely } from '../store/slices/nostrSlice';
import DatabaseService, { NetworkConfig } from './DatabaseService';
import ErrorHandlingService from './ErrorHandlingService';
import NodeConfigValidator from './NodeConfigValidator';

const DEFAULT_TIMEOUT = 30000;

export interface InitializationResult {
  success: boolean;
  service: string;
  error?: string;
  canContinue: boolean;
}

export async function initializeRGBApiService(): Promise<InitializationResult> {
  console.log('Initializing RGB API Service...');
  
  const errorHandler = ErrorHandlingService.getInstance();
  const validator = NodeConfigValidator.getInstance();

  try {
    // Check if we already have an instance and it's initialized
    const apiService = RGBApiService.getInstance();
    if (apiService.isApiInitialized()) {
      console.log('Using existing initialized RGB API Service instance');
      
      // Verify it's still healthy
      try {
        const isHealthy = await apiService.checkHealth();
        if (isHealthy) {
          return {
            success: true,
            service: 'RGB API',
            canContinue: true,
          };
        }
      } catch (error) {
        console.warn('Existing API service is not healthy, reinitializing...');
      }
    }

    // Try to get URL from active wallet's RLN config
    const state = getStore().getState();
    const activeWallet = state.wallet?.activeWallet;

    if (!activeWallet) {
      return {
        success: false,
        service: 'RGB API',
        error: 'No active wallet found. Please create or select a wallet first.',
        canContinue: true, // Can continue without node for wallet creation
      };
    }

    const rlnConfig = activeWallet.networks?.find((n: NetworkConfig) => n.type === 'rln' && n.enabled);
    
    if (!rlnConfig || !rlnConfig.config) {
      return {
        success: false,
        service: 'RGB API',
        error: 'RGB node not configured. Please configure node in wallet settings.',
        canContinue: true,
      };
    }

    // Parse and validate configuration
    const config = JSON.parse(rlnConfig.config);
    const nodeConfig = {
      type: config.type,
      url: config.type === 'remote' ? config.url : 'http://127.0.0.1:3000',
      timeout: DEFAULT_TIMEOUT,
    };

    // Validate configuration
    const validation = await validator.validateConfig(nodeConfig);
    
    if (!validation.valid) {
      console.error('Node configuration validation failed:', validation.errors);
      return {
        success: false,
        service: 'RGB API',
        error: validation.errors[0] || 'Invalid node configuration',
        canContinue: false,
      };
    }

    // Log warnings if any
    if (validation.warnings.length > 0) {
      console.warn('Node configuration warnings:', validation.warnings);
    }

    // Initialize API service with validated config
    console.log('Initializing RGB API Service with validated config:', nodeConfig.url);
    apiService.initialize({
      baseURL: nodeConfig.url!,
      timeout: DEFAULT_TIMEOUT,
    });

    // Initialize node service
    const nodeService = RGBNodeService.getInstance();
    await nodeService.initializeNode();

    // Verify initialization
    if (apiService.isApiInitialized()) {
      // Test connection
      try {
        await apiService.checkHealth();
        console.log('RGB API Service initialized and healthy');
        
        return {
          success: true,
          service: 'RGB API',
          canContinue: true,
        };
      } catch (error) {
        const appError = errorHandler.parseError(error, 'RGB API Health Check');
        console.warn('API initialized but health check failed:', appError.message);
        
        return {
          success: false,
          service: 'RGB API',
          error: appError.userMessage,
          canContinue: true, // Can continue with degraded functionality
        };
      }
    }

    return {
      success: false,
      service: 'RGB API',
      error: 'Failed to initialize API service',
      canContinue: false,
    };
  } catch (error: any) {
    const appError = errorHandler.parseError(error, 'RGB API Initialization');
    console.error('Failed to initialize RGB API Service:', appError);
    
    return {
      success: false,
      service: 'RGB API',
      error: appError.userMessage,
      canContinue: true, // Allow app to continue for wallet management
    };
  }
}

export function updateRGBApiConfig() {
  const settings = getStore().getState().settings;
  console.log('Updating RGB API config with settings:', settings);

  // If settings are not available, we can't update the API service yet
  if (!settings?.remoteNodeUrl) {
    console.warn('Settings not available yet, deferring API service config update');
    return null;
  }

  const config = {
    baseURL: settings.remoteNodeUrl.trim(),
    timeout: DEFAULT_TIMEOUT,
  };

  console.log('Updating RGB API Service with config:', config);

  try {
    const instance = createApiInstance(config);
    if (!instance.isApiInitialized()) {
      console.warn('RGB API Service initialization incomplete after config update');
      return null;
    }
    return instance;
  } catch (error) {
    console.error('Failed to update RGB API Service config:', error);
    return null;
  }
}

export async function initializeNostrWalletConnect() {
  try {
    console.log('Initializing Nostr Wallet Connect...');

    const nostrService = NostrService.getInstance();
    const nwcService = NWCService.getInstance();

    // Initialize NostrService first (if not already done)
    const settings = getStore().getState().settings;
    if (!nostrService.connected) {
      await nostrService.initialize({
        relays: [
          'wss://relay.damus.io',
          'wss://relay.snort.social',
          'wss://nos.lol',
        ],
      });
    }

    // Initialize NWC service
    const success = await nostrService.initializeNWC();

    if (success) {
      console.log('Nostr Wallet Connect initialized successfully');

      // Optionally generate a connection string for testing
      const connectionString = await nostrService.getWalletConnectInfo(
        ['pay_invoice', 'make_invoice', 'get_balance', 'get_info'],
        undefined
      );

      if (connectionString) {
        console.log('NWC Connection String:', connectionString);
        // You might want to store this or make it available to the UI
      }
    } else {
      console.error('Failed to initialize Nostr Wallet Connect');
    }

    return success;
  } catch (error) {
    console.error('Error initializing Nostr Wallet Connect:', error);
    return false;
  }
}

export async function getNostrWalletConnectStatus() {
  try {
    const nostrService = NostrService.getInstance();
    return nostrService.getNWCStatus();
  } catch (error) {
    console.error('Error getting NWC status:', error);
    return null;
  }
}

export async function autoRestoreNostrConnection() {
  try {
    console.log('Attempting to auto-restore Nostr connection...');

    const state = getStore().getState();

    // Check if we have stored keys indicator
    if (!state.nostr.hasStoredKeys) {
      console.log('No stored keys found, skipping auto-restore');
      return false;
    }

    // Try to restore the connection
    const result = await getStore().dispatch(restoreNostrConnection() as any);

    if (restoreNostrConnection.fulfilled.match(result)) {
      console.log('Nostr connection restored successfully');
      return true;
    } else {
      console.log('Failed to restore Nostr connection:', (result as any).error?.message);
      return false;
    }
  } catch (error) {
    console.error('Error during Nostr auto-restore:', error);
    return false;
  }
}