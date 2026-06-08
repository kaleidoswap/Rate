

// store/slices/settingsSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { DisclosureLevel } from '@kaleidorg/wallet-engine';
import type { RootState } from '../index';

// KaleidoMind (on-device AI) mode. Chosen once in onboarding, changeable in
// settings:
//   'off'      AI disabled (the QVAC Bare worklet never starts)
//   'local'    run the model on this device
//   'delegate' run it on a paired desktop; the phone relays
export type AiMode = 'off' | 'local' | 'delegate';

// User-tunable KaleidoMind agent configuration (persisted). Lets the user shape
// the agent's behaviour, sampling, context window, and knowledge/memory.
export interface MindConfig {
  /** Extra instructions appended to the agent's system prompt (its "persona"). */
  persona: string;
  /** Sampling temperature 0..1 (lower = more deterministic). */
  temperature: number;
  /** Max tokens per reply. */
  maxTokens: number;
  /** How many past messages to keep in context. */
  historyLength: number;
  /** Ground answers in the on-device knowledge base (RAG). */
  ragEnabled: boolean;
  /** Long-term memory: let the agent remember/recall preferences. */
  memoryEnabled: boolean;
  /** Skill names the user has turned OFF (bundled skills are on by default). */
  disabledSkills: string[];
  /** User-added MCP connectors (name + URL). */
  mcpServers: { name: string; url: string }[];
}

export const DEFAULT_MIND_CONFIG: MindConfig = {
  persona: '',
  temperature: 0.6,
  maxTokens: 512,
  historyLength: 8,
  ragEnabled: true,
  memoryEnabled: true,
  disabledSkills: [],
  mcpServers: [],
};

// Primary denomination the balance/amounts are shown in. Cycled by tapping the
// balance (sats → BTC → fiat → sats). Distinct from `bitcoinUnit`, which only
// covers the BTC/sats sub-choice used for amount *entry* in send/receive.
export type DisplayDenomination = 'sats' | 'BTC' | 'fiat';
const DENOMINATION_CYCLE: DisplayDenomination[] = ['sats', 'BTC', 'fiat'];

interface SettingsState {
  nodeType: 'remote' | 'local';
  remoteNodeUrl: string;
  nodePort: number;
  bitcoinUnit: 'BTC' | 'sats';
  // Primary denomination for displaying balances/amounts (tap-to-cycle).
  displayDenomination: DisplayDenomination;
  theme: 'light' | 'dark' | 'system';
  language: string;
  notifications: boolean;
  transactionNotifications: boolean;
  priceAlerts: boolean;
  hideBalances: boolean;
  // UI sound effects (paired with haptics for accessible, multi-modal feedback).
  soundEnabled: boolean;
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
  // User-tunable agent configuration (persona, sampling, context, RAG, memory).
  mindConfig: MindConfig;
}

const initialState: SettingsState = {
  nodeType: 'remote',
  remoteNodeUrl: '', // thunderstack url
  nodePort: 3000,
  bitcoinUnit: 'sats',
  displayDenomination: 'sats',
  theme: 'dark',
  language: 'en',
  notifications: true,
  transactionNotifications: true,
  priceAlerts: false,
  hideBalances: false,
  soundEnabled: true,
  biometricEnabled: false,
  pinEnabled: false,
  autoLockTimeout: 5,
  currency: 'USD',
  network: 'regtest',
  needsApiConfigUpdate: false,
  disclosureLevel: 'lite',
  aiMode: 'off',
  aiOnboarded: false,
  mindConfig: DEFAULT_MIND_CONFIG,
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
    setDisplayDenomination: (state, action: PayloadAction<DisplayDenomination>) => {
      state.displayDenomination = action.payload;
    },
    // Single source of truth for the unit preference. Sets the display
    // denomination AND mirrors the sats/BTC choice into `bitcoinUnit` (the
    // amount-entry unit) so display and input never disagree. 'fiat' leaves the
    // crypto entry unit on its last sats/BTC value.
    setUnitPreference: (state, action: PayloadAction<DisplayDenomination>) => {
      state.displayDenomination = action.payload;
      if (action.payload === 'sats' || action.payload === 'BTC') {
        state.bitcoinUnit = action.payload;
      }
    },
    // Advance the display denomination one step: sats → BTC → fiat → sats.
    // Mirrors the sats/BTC choice into `bitcoinUnit` so tap-to-cycle stays
    // consistent with amount entry.
    cycleDisplayDenomination: (state) => {
      const current = state.displayDenomination ?? 'sats';
      const idx = DENOMINATION_CYCLE.indexOf(current);
      const next = DENOMINATION_CYCLE[(idx + 1) % DENOMINATION_CYCLE.length];
      state.displayDenomination = next;
      if (next === 'sats' || next === 'BTC') state.bitcoinUnit = next;
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
    setSoundEnabled: (state, action: PayloadAction<boolean>) => {
      state.soundEnabled = action.payload;
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
    setMindConfig: (state, action: PayloadAction<Partial<MindConfig>>) => {
      state.mindConfig = { ...DEFAULT_MIND_CONFIG, ...state.mindConfig, ...action.payload };
    },
    resetMindConfig: (state) => {
      state.mindConfig = DEFAULT_MIND_CONFIG;
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
  setDisplayDenomination,
  setUnitPreference,
  cycleDisplayDenomination,
  setTheme,
  setLanguage,
  setNotifications,
  setTransactionNotifications,
  setPriceAlerts,
  setHideBalances,
  setSoundEnabled,
  setBiometricEnabled,
  setPinEnabled,
  setAutoLockTimeout,
  setCurrency,
  setNetwork,
  setDisclosureLevel,
  setMindConfig,
  resetMindConfig,
  setAiMode,
  setAiOnboarded,
  setAiEnabled,
  clearApiConfigUpdateFlag
} = settingsSlice.actions;

// UI sound effects. Defaults true for state persisted before this field existed.
export const selectSoundEnabled = (state: RootState): boolean =>
  state.settings.soundEnabled ?? true;

// Selector for the current disclosure level ('lite' | 'advanced').
// Falls back to 'lite' for state persisted before this field existed.
export const selectDisclosureLevel = (state: RootState): DisclosureLevel =>
  state.settings.disclosureLevel ?? 'lite';

// Primary display denomination. Falls back to the existing bitcoinUnit (or
// 'sats') for state persisted before this field existed.
export const selectDisplayDenomination = (state: RootState): DisplayDenomination =>
  state.settings.displayDenomination ?? state.settings.bitcoinUnit ?? 'sats';

// KaleidoMind mode. Defaults 'off' so the QVAC worklet never auto-starts.
export const selectAiMode = (state: RootState): AiMode =>
  state.settings.aiMode ?? 'off';

// Derived on/off used by the worklet kill switch and AI entry points.
export const selectAiEnabled = (state: RootState): boolean =>
  (state.settings.aiMode ?? 'off') !== 'off';

// Whether the user has completed the one-time KaleidoMind onboarding.
export const selectAiOnboarded = (state: RootState): boolean =>
  state.settings.aiOnboarded ?? false;

// Returns the stored object (stable ref) so useSelector doesn't re-render on
// every dispatch; the reducer always writes a complete MindConfig, and older
// persisted state with no mindConfig falls back to the constant default.
export const selectMindConfig = (state: RootState): MindConfig =>
  state.settings.mindConfig ?? DEFAULT_MIND_CONFIG;

export default settingsSlice.reducer;
