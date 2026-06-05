// __tests__/setup/test-utils.tsx
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { NavigationContainer } from '@react-navigation/native';
import walletReducer from '../../store/slices/walletSlice';
import assetsReducer from '../../store/slices/assetsSlice';
import settingsReducer from '../../store/slices/settingsSlice';
import nodeReducer from '../../store/slices/nodeSlice';
import nostrReducer from '../../store/slices/nostrSlice';
import transactionsReducer from '../../store/slices/transactionsSlice';
import swapReducer from '../../store/slices/swapSlice';
import uiReducer from '../../store/slices/uiSlice';
import contactsReducer from '../../store/slices/contactsSlice';

interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  preloadedState?: any;
  store?: any;
}

/**
 * Create a test store with optional preloaded state
 */
export function createTestStore(preloadedState?: any) {
  return configureStore({
    reducer: {
      wallet: walletReducer,
      assets: assetsReducer,
      settings: settingsReducer,
      node: nodeReducer,
      nostr: nostrReducer,
      transactions: transactionsReducer,
      swap: swapReducer,
      ui: uiReducer,
      contacts: contactsReducer,
    },
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }),
  });
}

/**
 * Custom render function with Redux Provider and Theme
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    preloadedState = {},
    store = createTestStore(preloadedState),
    ...renderOptions
  }: ExtendedRenderOptions = {}
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Provider store={store}>
        {children}
      </Provider>
    );
  }

  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}

/**
 * Custom render with navigation
 */
export function renderWithNavigation(
  ui: ReactElement,
  {
    preloadedState = {},
    store = createTestStore(preloadedState),
    ...renderOptions
  }: ExtendedRenderOptions = {}
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Provider store={store}>
        <NavigationContainer>
          {children}
        </NavigationContainer>
      </Provider>
    );
  }

  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}

/**
 * Mock navigation object
 */
export const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  reset: jest.fn(),
  setParams: jest.fn(),
  dispatch: jest.fn(),
  isFocused: jest.fn(() => true),
  canGoBack: jest.fn(() => true),
  getId: jest.fn(),
  getParent: jest.fn(),
  getState: jest.fn(),
  replace: jest.fn(),
  push: jest.fn(),
  pop: jest.fn(),
  popToTop: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
};

/**
 * Mock route object
 */
export const mockRoute = {
  key: 'test-route',
  name: 'TestScreen',
  params: {},
  path: undefined,
};

/**
 * Create mock navigation with custom params
 */
export function createMockNavigation(overrides = {}) {
  return {
    ...mockNavigation,
    ...overrides,
  };
}

/**
 * Create mock route with custom params
 */
export function createMockRoute(params = {}, name = 'TestScreen') {
  return {
    ...mockRoute,
    name,
    params,
  };
}

/**
 * Wait for async updates
 */
export const waitFor = (callback: () => void, timeout = 1000) =>
  new Promise((resolve) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      try {
        callback();
        clearInterval(interval);
        resolve(true);
      } catch (error) {
        if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          resolve(false);
        }
      }
    }, 50);
  });

// Re-export everything from React Native Testing Library
export * from '@testing-library/react-native';



