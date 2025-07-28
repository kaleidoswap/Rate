// services/apiInstance.ts
import RGBApiService from './RGBApiService';

let apiInstance: RGBApiService | null = null;

export function getApiInstance(): RGBApiService | null {
  return apiInstance;
}

export function setApiInstance(instance: RGBApiService | null) {
  apiInstance = instance;
}

export function createApiInstance(config: { baseURL: string; timeout: number }): RGBApiService {
  const instance = RGBApiService.getInstance();
  instance.initialize(config);
  setApiInstance(instance);
  return instance;
} 