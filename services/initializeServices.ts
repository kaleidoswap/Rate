// services/initializeServices.ts
import { getStore } from '../store/storeProvider';
import NostrService from './NostrService';
import NWCService from './NWCService';
import { restoreNostrConnection } from '../store/slices/nostrSlice';
import type { NetworkConfig } from './DatabaseService';
import { protocolManager, initializeProtocols } from './protocols';
import type { ProtocolType } from './protocols';

/**
 * Initialize all wallet protocols via the shared ProtocolManager.
 * Reads active wallet networks from Redux state and connects each enabled protocol.
 */
export async function initializeProtocolServices(): Promise<{
  results: Map<ProtocolType, { success: boolean; error?: string }>;
  canContinue: boolean;
}> {
  console.log('Initializing Protocol Services...');

  try {
    const state = getStore().getState();
    const activeWallet = state.wallet?.activeWallet;

    if (!activeWallet) {
      console.warn('No active wallet found, skipping protocol initialization');
      return { results: new Map(), canContinue: true };
    }

    // Mnemonic is stored in encrypted_mnemonic field (or mnemonic for compat)
    const mnemonic = (activeWallet as any).encrypted_mnemonic || (activeWallet as any).mnemonic || '';
    const networks = activeWallet.networks || [];

    if (!mnemonic) {
      console.warn('No mnemonic available, skipping protocol initialization');
      return { results: new Map(), canContinue: true };
    }

    const results = await initializeProtocols(mnemonic, networks);

    const anyConnected = Array.from(results.values()).some(r => r.success);
    console.log(`Protocol initialization complete: ${results.size} attempted, ${anyConnected ? 'at least one connected' : 'none connected'}`);

    return { results, canContinue: true };
  } catch (error: any) {
    console.error('Failed to initialize protocol services:', error);
    return { results: new Map(), canContinue: true };
  }
}

export async function initializeNostrWalletConnect() {
  try {
    console.log('Initializing Nostr Wallet Connect...');

    const nostrService = NostrService.getInstance();

    const settings = getStore().getState().settings;
    if (!nostrService.connected) {
      await nostrService.initialize({
        relays: [
          'wss://relay.kaleidoswap.com',
          'wss://relay.damus.io',
          'wss://relay.snort.social',
          'wss://nos.lol',
        ],
      });
    }

    const success = await nostrService.initializeNWC();

    if (success) {
      console.log('Nostr Wallet Connect initialized successfully');
      const connectionString = await nostrService.getWalletConnectInfo(
        ['pay_invoice', 'make_invoice', 'get_balance', 'get_info'],
        undefined
      );
      if (connectionString) {
        console.log('NWC Connection String:', connectionString);
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

    if (!state.nostr.hasStoredKeys) {
      console.log('No stored keys found, skipping auto-restore');
      return false;
    }

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
