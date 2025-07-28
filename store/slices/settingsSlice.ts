

// store/slices/settingsSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SettingsState {
  // App preferences
  theme: 'light' | 'dark' | 'system';
  currency: 'USD' | 'EUR' | 'BTC' | 'SAT';
  language: 'en' | 'es' | 'fr' | 'it';
  
  // Network settings
  network: 'mainnet' | 'testnet' | 'regtest' | 'signet';
  
  // Security settings
  biometricEnabled: boolean;
  pinEnabled: boolean;
  autoLockTimeout: number; // minutes
  
  // Notification settings
  notifications: boolean;
  transactionNotifications: boolean;
  priceAlerts: boolean;
  
  // Privacy settings
  hideBalances: boolean;
  
  // Node settings
  nodeType: 'local' | 'remote';
  remoteNodeUrl: string;
  bitcoindConfig: {
    host: string;
    port: number;
    username: string;
    password: string;
  } | null;
  indexerUrl: string;
  proxyEndpoint: string;
  
  // Sync settings
  autoSync: boolean;
  syncInterval: number; // minutes
  
  // Developer settings
  developerMode: boolean;
  debugLogging: boolean;
}

const initialState: SettingsState = {
  theme: 'system',
  currency: 'USD',
  language: 'en',
  network: 'regtest',
  biometricEnabled: false,
  pinEnabled: false,
  autoLockTimeout: 5,
  notifications: true,
  transactionNotifications: true,
  priceAlerts: false,
  hideBalances: false,
  nodeType: 'remote',
  remoteNodeUrl: 'https://node-api.thunderstack.org/c1cb65e0-b071-7027-7994-ecad2c46d5ec/efa615e2a9ad4ca4a3f7e8203d73fce3',
  bitcoindConfig: null, // Set to null by default since we're using remote node
  indexerUrl: '127.0.0.1:50001',
  proxyEndpoint: 'rpc://127.0.0.1:3000/json-rpc',
  autoSync: true,
  syncInterval: 5,
  developerMode: false,
  debugLogging: false,
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    // App preferences
    setTheme: (state, action: PayloadAction<'light' | 'dark' | 'system'>) => {
      state.theme = action.payload;
    },
    setCurrency: (state, action: PayloadAction<'USD' | 'EUR' | 'BTC' | 'SAT'>) => {
      state.currency = action.payload;
    },
    setLanguage: (state, action: PayloadAction<'en' | 'es' | 'fr' | 'it'>) => {
      state.language = action.payload;
    },
    
    // Network settings
    setNetwork: (state, action: PayloadAction<'mainnet' | 'testnet' | 'regtest' | 'signet'>) => {
      state.network = action.payload;
    },
    
    // Security settings
    setBiometricEnabled: (state, action: PayloadAction<boolean>) => {
      state.biometricEnabled = action.payload;
    },
    setPinEnabled: (state, action: PayloadAction<boolean>) => {
      state.pinEnabled = action.payload;
    },
    setAutoLockTimeout: (state, action: PayloadAction<number>) => {
      state.autoLockTimeout = action.payload;
    },
    
    // Notification settings
    setNotifications: (state, action: PayloadAction<boolean>) => {
      state.notifications = action.payload;
    },
    setTransactionNotifications: (state, action: PayloadAction<boolean>) => {
      state.transactionNotifications = action.payload;
    },
    setPriceAlerts: (state, action: PayloadAction<boolean>) => {
      state.priceAlerts = action.payload;
    },
    
    // Privacy settings
    setHideBalances: (state, action: PayloadAction<boolean>) => {
      state.hideBalances = action.payload;
    },
    
    // Node settings
    setNodeType: (state, action: PayloadAction<'local' | 'remote'>) => {
      state.nodeType = action.payload;
    },
    setRemoteNodeUrl: (state, action: PayloadAction<string>) => {
      state.remoteNodeUrl = action.payload;
    },
    setBitcoindConfig: (state, action: PayloadAction<SettingsState['bitcoindConfig']>) => {
      state.bitcoindConfig = action.payload;
    },
    setIndexerUrl: (state, action: PayloadAction<string>) => {
      state.indexerUrl = action.payload;
    },
    setProxyEndpoint: (state, action: PayloadAction<string>) => {
      state.proxyEndpoint = action.payload;
    },
    
    // Sync settings
    setAutoSync: (state, action: PayloadAction<boolean>) => {
      state.autoSync = action.payload;
    },
    setSyncInterval: (state, action: PayloadAction<number>) => {
      state.syncInterval = action.payload;
    },
    
    // Developer settings
    setDeveloperMode: (state, action: PayloadAction<boolean>) => {
      state.developerMode = action.payload;
    },
    setDebugLogging: (state, action: PayloadAction<boolean>) => {
      state.debugLogging = action.payload;
    },
    
    // Bulk update
    updateSettings: (state, action: PayloadAction<Partial<SettingsState>>) => {
      return { ...state, ...action.payload };
    },
    
    // Reset to defaults
    resetSettings: () => initialState,
  },
});

export const {
  setTheme,
  setCurrency,
  setLanguage,
  setNetwork,
  setBiometricEnabled,
  setPinEnabled,
  setAutoLockTimeout,
  setNotifications,
  setTransactionNotifications,
  setPriceAlerts,
  setHideBalances,
  setNodeType,
  setRemoteNodeUrl,
  setBitcoindConfig,
  setIndexerUrl,
  setProxyEndpoint,
  setAutoSync,
  setSyncInterval,
  setDeveloperMode,
  setDebugLogging,
  updateSettings,
  resetSettings,
} = settingsSlice.actions;

export default settingsSlice.reducer;
