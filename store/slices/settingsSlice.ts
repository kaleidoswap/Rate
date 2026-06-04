

// store/slices/settingsSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { DisclosureLevel } from '@kaleidorg/wallet-protocols';
import type { RootState } from '../index';

// KaleidoMind (on-device AI) mode. Chosen once in onboarding, changeable in
// settings:
//   'off'      AI disabled (the QVAC Bare worklet never starts)
//   'local'    run the model on this device
//   'delegate' run it on a paired desktop; the phone relays
export type AiMode = 'off' | 'local' | 'delegate';

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
  needsApiConfigUpdate: boolean;
  // 'lite' shows BTC/USD/assets only; 'advanced' reveals networks/routes/channels.
  // Chosen at wallet creation, reversible in settings.
  disclosureLevel: DisclosureLevel;
  // KaleidoMind mode — defaults 'off' so the QVAC Bare worklet never starts
  // unprompted (which can crash on a native/JS mismatch or the iOS Simulator).
  aiMode: AiMode;
  // Whether the user has been through the one-time KaleidoMind onboarding.
  aiOnboarded: boolean;
}

const initialState: SettingsState = {
  nodeType: 'remote',
  remoteNodeUrl: '', // thunderstack url
  nodePort: 3000,
  bitcoinUnit: 'sats',
  theme: 'dark',
  language: 'en',
  notifications: true,
  transactionNotifications: true,
  priceAlerts: false,
  hideBalances: false,
  biometricEnabled: false,
  pinEnabled: false,
  autoLockTimeout: 5,
  currency: 'USD',
  network: 'regtest',
  needsApiConfigUpdate: false,
  disclosureLevel: 'lite',
  aiMode: 'off',
  aiOnboarded: false,
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setNodeType: (state, action: PayloadAction<'remote' | 'local'>) => {
      state.nodeType = action.payload;
      state.needsApiConfigUpdate = true;
    },
    setRemoteNodeUrl: (state, action: PayloadAction<string>) => {
      state.remoteNodeUrl = action.payload;
      state.needsApiConfigUpdate = true;
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
    },
    setDisclosureLevel: (state, action: PayloadAction<DisclosureLevel>) => {
      state.disclosureLevel = action.payload;
    },
    setAiMode: (state, action: PayloadAction<AiMode>) => {
      state.aiMode = action.payload;
    },
    setAiOnboarded: (state, action: PayloadAction<boolean>) => {
      state.aiOnboarded = action.payload;
    },
    // Convenience on/off toggle that preserves a chosen 'delegate' setup.
    setAiEnabled: (state, action: PayloadAction<boolean>) => {
      if (action.payload) {
        if (state.aiMode === 'off') state.aiMode = 'local';
      } else {
        state.aiMode = 'off';
      }
    },
    clearApiConfigUpdateFlag: (state) => {
      state.needsApiConfigUpdate = false;
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
  setNetwork,
  setDisclosureLevel,
  setAiMode,
  setAiOnboarded,
  setAiEnabled,
  clearApiConfigUpdateFlag
} = settingsSlice.actions;

// Selector for the current disclosure level ('lite' | 'advanced').
// Falls back to 'lite' for state persisted before this field existed.
export const selectDisclosureLevel = (state: RootState): DisclosureLevel =>
  state.settings.disclosureLevel ?? 'lite';

// KaleidoMind mode. Defaults 'off' so the QVAC worklet never auto-starts.
export const selectAiMode = (state: RootState): AiMode =>
  state.settings.aiMode ?? 'off';

// Derived on/off used by the worklet kill switch and AI entry points.
export const selectAiEnabled = (state: RootState): boolean =>
  (state.settings.aiMode ?? 'off') !== 'off';

// Whether the user has completed the one-time KaleidoMind onboarding.
export const selectAiOnboarded = (state: RootState): boolean =>
  state.settings.aiOnboarded ?? false;

export default settingsSlice.reducer;
