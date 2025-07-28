// store/middleware/apiConfigMiddleware.ts
import { Middleware } from '@reduxjs/toolkit';
import { updateRGBApiConfig } from '../../services/initializeServices';
import { clearApiConfigUpdateFlag } from '../slices/settingsSlice';

export const apiConfigMiddleware: Middleware = store => next => action => {
  const result = next(action);
  const state = store.getState();

  // Check if we need to update the API config
  if (state.settings.needsApiConfigUpdate) {
    console.log('API config update needed, updating...');
    updateRGBApiConfig();
    store.dispatch(clearApiConfigUpdateFlag());
  }

  return result;
}; 