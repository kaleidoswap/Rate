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
});

// Get the actual state type from the root reducer
type RootReducerState = ReturnType<typeof rootReducer>;

// Redux persist configuration
const persistConfig: PersistConfig<RootReducerState> = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['settings', 'ui', 'contacts', 'nostr'], // Added nostr to persist non-sensitive nostr data
  blacklist: ['wallet', 'node', 'assets', 'transactions', 'swap'], // Removed nostr from blacklist
  version: 1,
  migrate: (state: any) => {
    // Handle migrations if needed
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

