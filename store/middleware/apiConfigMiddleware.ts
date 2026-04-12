// store/middleware/apiConfigMiddleware.ts
import { Middleware } from '@reduxjs/toolkit';
import { protocolManager } from '../../services/protocols';
import { clearApiConfigUpdateFlag } from '../slices/settingsSlice';

export const apiConfigMiddleware: Middleware = store => next => action => {
  const result = next(action);
  const state = store.getState();

  // Check if we need to update the API config
  if (state.settings.needsApiConfigUpdate) {
    console.log('API config update needed, reconnecting RGB protocol...');
    const settings = state.settings;
    if (settings?.remoteNodeUrl) {
      protocolManager.connect('RGB', {
        protocol: 'RGB',
        nodeUrl: settings.remoteNodeUrl.trim(),
      } as any).catch(err => {
        console.warn('Failed to reconnect RGB protocol:', err);
      });
    }
    store.dispatch(clearApiConfigUpdateFlag());
  }

  return result;
};
