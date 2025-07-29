// services/initializeServices.ts
import { store } from '../store';
import { createApiInstance, getApiInstance } from './apiInstance';
import RGBApiService from './RGBApiService';
import { RGBNodeService } from './RGBNodeService';
import NostrService from './NostrService';
import NWCService from './NWCService';
import { restoreNostrConnection, loadKeysSecurely } from '../store/slices/nostrSlice';

const DEFAULT_TIMEOUT = 30000;

export function initializeRGBApiService() {
  const settings = store.getState().settings;
  console.log('Initializing RGB API Service with settings:', settings);

  // Check if we already have an instance and it's initialized
  const existingInstance = getApiInstance();
  if (existingInstance && existingInstance.isApiInitialized()) {
    console.log('Using existing initialized RGB API Service instance');
    return existingInstance;
  }

  // Initialize node service first
  const nodeService = RGBNodeService.getInstance();
  nodeService.initializeNode();

  // If settings are not available, we can't initialize the API service yet
  if (!settings?.remoteNodeUrl) {
    console.warn('Settings not available yet, deferring API service initialization');
    return null;
  }

  const config = {
    baseURL: settings.remoteNodeUrl.trim(),
    timeout: DEFAULT_TIMEOUT,
  };

  console.log('Creating RGB API Service with config:', config);
  
  try {
    const instance = createApiInstance(config);
    if (!instance.isApiInitialized()) {
      console.warn('RGB API Service initialization incomplete');
      return null;
    }
    return instance;
  } catch (error) {
    console.error('Failed to initialize RGB API Service:', error);
    return null;
  }
}

export function updateRGBApiConfig() {
  const settings = store.getState().settings;
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
    
    // Initialize NostrService first (if not already done)
    const settings = store.getState().settings;
    if (!nostrService.connected) {
      await nostrService.initialize({
        relays: settings?.nostrRelays || [
          'wss://relay.damus.io',
          'wss://relay.snort.social',
          'wss://nos.lol',
        ],
      });
    }
    
    // Initialize NWC service
    const success = await nostrService.initializeNWC(settings?.nostrRelays);
    
    if (success) {
      console.log('Nostr Wallet Connect initialized successfully');
      
      // Optionally generate a connection string for testing
      const connectionString = await nostrService.getWalletConnectInfo(
        ['pay_invoice', 'make_invoice', 'get_balance', 'get_info'],
        settings?.lud16
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
    
    const state = store.getState();
    
    // Check if we have stored keys indicator
    if (!state.nostr.hasStoredKeys) {
      console.log('No stored keys found, skipping auto-restore');
      return false;
    }
    
    // Try to restore the connection
    const result = await store.dispatch(restoreNostrConnection());
    
    if (restoreNostrConnection.fulfilled.match(result)) {
      console.log('Nostr connection restored successfully');
      return true;
    } else {
      console.log('Failed to restore Nostr connection:', result.error?.message);
      return false;
    }
  } catch (error) {
    console.error('Error during Nostr auto-restore:', error);
    return false;
  }
}