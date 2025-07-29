// store/storeProvider.ts
import { Store } from '@reduxjs/toolkit';

let store: Store | null = null;

export function setStore(s: Store) {
  store = s;
}

export function getStore(): Store {
  if (!store) {
    throw new Error('Store not initialized');
  }
  return store;
} 