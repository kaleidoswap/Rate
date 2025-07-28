// services/initializeServices.ts
import { store } from '../store';
import { createApiInstance, getApiInstance } from './apiInstance';
import RGBApiService from './RGBApiService';
import { RGBNodeService } from './RGBNodeService';

const DEFAULT_TIMEOUT = 30000;

export function initializeRGBApiService() {
  const settings = store.getState().settings;
  console.log('Initializing RGB API Service with settings:', settings);

  // Check if we already have an instance and it's initialized
  const existingInstance = getApiInstance();
  if (existingInstance && existingInstance.isApiInitialized()) {
    console.log('Using existing initialized RGB API Service instance');
    return existingInstance;
  }

  // Initialize node service first
  const nodeService = RGBNodeService.getInstance();
  nodeService.initializeNode();

  // If settings are not available, we can't initialize the API service yet
  if (!settings?.remoteNodeUrl) {
    console.warn('Settings not available yet, deferring API service initialization');
    return null;
  }

  const config = {
    baseURL: settings.remoteNodeUrl.trim(),
    timeout: DEFAULT_TIMEOUT,
  };

  console.log('Creating RGB API Service with config:', config);
  
  try {
    const instance = createApiInstance(config);
    if (!instance.isApiInitialized()) {
      console.warn('RGB API Service initialization incomplete');
      return null;
    }
    return instance;
  } catch (error) {
    console.error('Failed to initialize RGB API Service:', error);
    return null;
  }
}

export function updateRGBApiConfig() {
  const settings = store.getState().settings;
  console.log('Updating RGB API config with settings:', settings);

  // If settings are not available, we can't update the API service yet
  if (!settings?.remoteNodeUrl) {
    console.warn('Settings not available yet, deferring API service config update');
    return null;
  }

  const config = {
    baseURL: settings.remoteNodeUrl.trim(),
    timeout: DEFAULT_TIMEOUT,
  };

  console.log('Updating RGB API Service with config:', config);
  
  try {
    const instance = createApiInstance(config);
    if (!instance.isApiInitialized()) {
      console.warn('RGB API Service initialization incomplete after config update');
      return null;
    }
    return instance;
  } catch (error) {
    console.error('Failed to update RGB API Service config:', error);
    return null;
  }
} 