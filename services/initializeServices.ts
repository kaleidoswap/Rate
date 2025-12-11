// services/initializeServices.ts
import { getStore } from '../store/storeProvider';
import { createApiInstance, getApiInstance } from './apiInstance';
import RGBApiService from './RGBApiService';
import { RGBNodeService } from './RGBNodeService';
import NostrService from './NostrService';
import NWCService from './NWCService';
import { restoreNostrConnection, loadKeysSecurely } from '../store/slices/nostrSlice';
import DatabaseService, { NetworkConfig } from './DatabaseService';

const DEFAULT_TIMEOUT = 30000;

export function initializeRGBApiService() {
  console.log('Initializing RGB API Service...');

  // Check if we already have an instance and it's initialized
  const apiService = RGBApiService.getInstance();
  if (apiService.isApiInitialized()) {
    console.log('Using existing initialized RGB API Service instance');
    return apiService;
  }

  // Try to get URL from active wallet's RLN config
  try {
    const state = getStore().getState();
    const activeWallet = state.wallet?.activeWallet;

    if (activeWallet) {
      const rlnConfig = activeWallet.networks?.find((n: NetworkConfig) => n.type === 'rln' && n.enabled);
      if (rlnConfig && rlnConfig.config) {
        try {
          const config = JSON.parse(rlnConfig.config);
          let apiUrl = '';

          if (config.type === 'remote' && config.url) {
            apiUrl = config.url;
          } else if (config.type === 'local') {
            apiUrl = 'http://127.0.0.1:3000';
          }

          if (apiUrl) {
            console.log('Initializing RGB API Service with wallet RLN config:', apiUrl);
            apiService.initialize({
              baseURL: apiUrl,
              timeout: DEFAULT_TIMEOUT,
            });

            // Initialize node service
            const nodeService = RGBNodeService.getInstance();
            nodeService.initializeNode();

            if (apiService.isApiInitialized()) {
              return apiService;
            }
          }
        } catch (e) {
          console.error('Failed to parse RLN config:', e);
        }
      }
    }

    // Fallback: Try to get from database if not in Redux (async, but we can't await here)
    // This will be handled by the caller or by InitialLoadScreen
    console.warn('No RLN config found in Redux state. API service should be initialized during app startup.');
    return null;
  } catch (error) {
    console.error('Failed to initialize RGB API Service:', error);
    return null;
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