// services/initializeServices.ts
import { store } from '../store';
import { createApiInstance, getApiInstance } from './apiInstance';

export function initializeRGBApiService() {
  const settings = store.getState().settings;
  console.log('Initializing RGB API Service with settings:', settings);

  // Check if we already have an instance
  const existingInstance = getApiInstance();
  if (existingInstance) {
    return existingInstance;
  }

  if (!settings?.remoteNodeUrl) {
    console.error('Node URL is undefined in settings!');
    throw new Error('Node URL is not configured. Please check your settings.');
  }

  const config = {
    baseURL: settings.remoteNodeUrl.trim(),
    timeout: 30000,
  };

  console.log('Creating RGB API Service with config:', config);
  
  try {
    return createApiInstance(config);
  } catch (error) {
    console.error('Failed to initialize RGB API Service:', error);
    throw error;
  }
}

export function updateRGBApiConfig() {
  const settings = store.getState().settings;
  console.log('Updating RGB API config with settings:', settings);

  if (!settings?.remoteNodeUrl) {
    console.error('Node URL is undefined in settings!');
    throw new Error('Node URL is not configured. Please check your settings.');
  }

  const config = {
    baseURL: settings.remoteNodeUrl.trim(),
    timeout: 30000,
  };

  console.log('Updating RGB API Service with config:', config);
  
  try {
    return createApiInstance(config);
  } catch (error) {
    console.error('Failed to update RGB API Service config:', error);
    throw error;
  }
} 