// store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer, PersistConfig, PURGE } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { combineReducers } from '@reduxjs/toolkit';

// Import slices
import walletReducer from './slices/walletSlice';
import nodeReducer from './slices/nodeSlice';
import settingsReducer from './slices/settingsSlice';
import assetsReducer from './slices/assetsSlice';
import transactionsReducer from './slices/transactionsSlice';
import uiReducer from './slices/uiSlice';
import contactsReducer from './slices/contactsSlice';
import swapReducer from './slices/swapSlice';
import nostrReducer from './slices/nostrSlice';
import chatReducer from './slices/chatSlice';

// Import middleware
import { apiConfigMiddleware } from './middleware/apiConfigMiddleware';
import { setStore } from './storeProvider';

// Combine all reducers first to get proper types
const rootReducer = combineReducers({
  wallet: walletReducer,
  node: nodeReducer,
  settings: settingsReducer,
  assets: assetsReducer,
  transactions: transactionsReducer,
  ui: uiReducer,
  contacts: contactsReducer,
  swap: swapReducer,
  nostr: nostrReducer,
  chat: chatReducer,
});

// Get the actual state type from the root reducer
type RootReducerState = ReturnType<typeof rootReducer>;

// Redux persist configuration
const persistConfig: PersistConfig<RootReducerState> = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['settings', 'ui', 'contacts', 'nostr', 'chat'], // chat: persist decrypted DM history locally
  blacklist: ['wallet', 'node', 'assets', 'transactions', 'swap'], // Removed nostr from blacklist
  version: 3,
  migrate: (state: any) => {
    // v2: replace the legacy default Nostr relay set with the current one.
    // The old defaults included relay.snort.social (frequently offline) and
    // nostr.wine (paid/auth-gated), which made Nostr appear broken. Only swap
    // when the persisted list is the untouched old default — never clobber a
    // list the user has customised.
    const LEGACY_DEFAULT_RELAYS = [
      'wss://relay.damus.io',
      'wss://relay.snort.social',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://nostr.wine',
    ];
    const CURRENT_DEFAULT_RELAYS = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://relay.primal.net',
      'wss://purplepag.es',
    ];
    try {
      const relays: string[] | undefined = state?.nostr?.relays;
      if (
        Array.isArray(relays) &&
        relays.length === LEGACY_DEFAULT_RELAYS.length &&
        relays.every((r, i) => r === LEGACY_DEFAULT_RELAYS[i])
      ) {
        state.nostr.relays = [...CURRENT_DEFAULT_RELAYS];
      }
    } catch {
      // Non-fatal: fall through with state unchanged.
    }
    // v3: backfill chat fields added after the slice first shipped. Old persisted
    // `chat` state replaces the slice wholesale on rehydrate (autoMergeLevel1 does
    // not deep-merge), so without this the new objects are undefined and reads
    // like `unreadByPubkey[...]` crash.
    try {
      if (state?.chat) {
        const c = state.chat;
        c.conversations = c.conversations || {};
        c.loadingByPubkey = c.loadingByPubkey || {};
        c.unreadByPubkey = c.unreadByPubkey || {};
        c.paidInvoices = c.paidInvoices || {};
        if (c.activePubkey === undefined) c.activePubkey = null;
        if (!c.sendScheme) c.sendScheme = 'nip17';
      }
    } catch {
      // Non-fatal.
    }
    return Promise.resolve(state);
  },
};

// Create persisted reducer
const persistedReducer = persistReducer(persistConfig, rootReducer);

// Configure store
export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          'persist/PERSIST',
          'persist/REHYDRATE',
          'persist/REGISTER',
          'persist/FLUSH',
          'persist/PAUSE',
          'persist/PURGE',
        ],
        ignoredPaths: ['register', 'nostr.privateKey'],
      },
      immutableCheck: {
        ignoredPaths: ['register'],
      },
    }).concat(apiConfigMiddleware),
  devTools: __DEV__,
});

// Set store in provider
setStore(store);

// Create persistor
export const persistor = persistStore(store);

// Keep the UI sound engine in sync with the persisted "Sound effects" setting,
// including across rehydration. Subscribing here (rather than in a component)
// means audio honours the preference before any screen mounts.
import { soundEngine } from '../services/sounds';
import { selectSoundEnabled } from './slices/settingsSlice';
let _lastSoundEnabled: boolean | undefined;
store.subscribe(() => {
  const enabled = selectSoundEnabled(store.getState() as RootState);
  if (enabled !== _lastSoundEnabled) {
    _lastSoundEnabled = enabled;
    soundEngine.setEnabled(enabled);
  }
});

// Function to reset the store
export const resetStore = async () => {
  await persistor.purge(); // Clear persisted state
  store.dispatch({ type: PURGE, key: persistConfig.key }); // Reset Redux state
  await AsyncStorage.clear(); // Clear all AsyncStorage
  await persistor.flush(); // Ensure changes are persisted
  await persistor.persist(); // Start persisting again
};

// Export proper RootState type without undefined for slices
// This is the actual state shape when the store is hydrated
export type RootState = RootReducerState & {
  _persist: { version: number; rehydrated: boolean };
};

export type AppDispatch = typeof store.dispatch;

// Typed hooks
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

