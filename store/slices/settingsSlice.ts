

// store/slices/settingsSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { updateRGBApiConfig } from '../../services/initializeServices';

interface SettingsState {
  nodeType: 'remote' | 'local';
  remoteNodeUrl: string;
  nodePort: number;
  bitcoinUnit: 'BTC' | 'sats';
  theme: 'light' | 'dark' | 'system';
  language: string;
  notifications: boolean;
  transactionNotifications: boolean;
  priceAlerts: boolean;
  hideBalances: boolean;
  biometricEnabled: boolean;
  pinEnabled: boolean;
  autoLockTimeout: number;
  currency: string;
  network: string;
}

const initialState: SettingsState = {
  nodeType: 'remote',
  remoteNodeUrl: 'https://node-api.thunderstack.org/c1cb65e0-b071-7027-7994-ecad2c46d5ec/efa615e2a9ad4ca4a3f7e8203d73fce3',
  nodePort: 3000,
  bitcoinUnit: 'BTC',
  theme: 'system',
  language: 'en',
  notifications: true,
  transactionNotifications: true,
  priceAlerts: false,
  hideBalances: false,
  biometricEnabled: false,
  pinEnabled: false,
  autoLockTimeout: 5,
  currency: 'USD',
  network: 'regtest'
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setNodeType: (state, action: PayloadAction<'remote' | 'local'>) => {
      state.nodeType = action.payload;
      updateRGBApiConfig();
    },
    setRemoteNodeUrl: (state, action: PayloadAction<string>) => {
      state.remoteNodeUrl = action.payload;
      updateRGBApiConfig();
    },
    setBitcoinUnit: (state, action: PayloadAction<'BTC' | 'sats'>) => {
      state.bitcoinUnit = action.payload;
    },
    setTheme: (state, action: PayloadAction<'light' | 'dark' | 'system'>) => {
      state.theme = action.payload;
    },
    setLanguage: (state, action: PayloadAction<string>) => {
      state.language = action.payload;
    },
    setNotifications: (state, action: PayloadAction<boolean>) => {
      state.notifications = action.payload;
    },
    setTransactionNotifications: (state, action: PayloadAction<boolean>) => {
      state.transactionNotifications = action.payload;
    },
    setPriceAlerts: (state, action: PayloadAction<boolean>) => {
      state.priceAlerts = action.payload;
    },
    setHideBalances: (state, action: PayloadAction<boolean>) => {
      state.hideBalances = action.payload;
    },
    setBiometricEnabled: (state, action: PayloadAction<boolean>) => {
      state.biometricEnabled = action.payload;
    },
    setPinEnabled: (state, action: PayloadAction<boolean>) => {
      state.pinEnabled = action.payload;
    },
    setAutoLockTimeout: (state, action: PayloadAction<number>) => {
      state.autoLockTimeout = action.payload;
    },
    setCurrency: (state, action: PayloadAction<string>) => {
      state.currency = action.payload;
    },
    setNetwork: (state, action: PayloadAction<string>) => {
      state.network = action.payload;
    }
  },
});

export const {
  setNodeType,
  setRemoteNodeUrl,
  setBitcoinUnit,
  setTheme,
  setLanguage,
  setNotifications,
  setTransactionNotifications,
  setPriceAlerts,
  setHideBalances,
  setBiometricEnabled,
  setPinEnabled,
  setAutoLockTimeout,
  setCurrency,
  setNetwork
} = settingsSlice.actions;

export default settingsSlice.reducer;
