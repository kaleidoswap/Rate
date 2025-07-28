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

// Import middleware
import { apiConfigMiddleware } from './middleware/apiConfigMiddleware';

// Redux persist configuration
const persistConfig: PersistConfig<any> = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['settings', 'ui'], // Only persist non-sensitive data
  blacklist: ['wallet', 'node', 'assets', 'transactions'], // Don't persist sensitive data
  version: 1,
  migrate: (state: any) => {
    // Handle migrations if needed
    return Promise.resolve(state);
  },
};

// Combine all reducers
const rootReducer = combineReducers({
  wallet: walletReducer,
  node: nodeReducer,
  settings: settingsReducer,
  assets: assetsReducer,
  transactions: transactionsReducer,
  ui: uiReducer,
});

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
        ignoredPaths: ['register'],
      },
      immutableCheck: {
        ignoredPaths: ['register'],
      },
    }).concat(apiConfigMiddleware),
  devTools: __DEV__,
});

// Create persistor
export const persistor = persistStore(store);

// Function to reset the store
export const resetStore = async () => {
  await persistor.purge(); // Clear persisted state
  store.dispatch({ type: PURGE, key: persistConfig.key }); // Reset Redux state
  await AsyncStorage.clear(); // Clear all AsyncStorage
  await persistor.flush(); // Ensure changes are persisted
  await persistor.persist(); // Start persisting again
};

// Export types
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed hooks
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

