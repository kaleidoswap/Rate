// services/SecurityService.ts
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import CryptoJS from 'crypto-js';

const SECURITY_KEYS = {
  PIN_HASH: 'rate_wallet_pin_hash',
  BIOMETRIC_ENABLED: 'rate_wallet_biometric_enabled',
  SECURITY_ENABLED: 'rate_wallet_security_enabled',
};

export interface SecuritySettings {
  pinEnabled: boolean;
  biometricEnabled: boolean;
  biometricType?: 'fingerprint' | 'face' | 'iris' | null;
}

export class SecurityService {
  private static instance: SecurityService;

  private constructor() {}

  public static getInstance(): SecurityService {
    if (!SecurityService.instance) {
      SecurityService.instance = new SecurityService();
    }
    return SecurityService.instance;
  }

  /**
   * Hash PIN using SHA-256
   */
  private hashPin(pin: string): string {
    return CryptoJS.SHA256(pin).toString();
  }

  /**
   * Save PIN securely
   */
  async savePin(pin: string): Promise<boolean> {
    try {
      const hashedPin = this.hashPin(pin);
      await SecureStore.setItemAsync(SECURITY_KEYS.PIN_HASH, hashedPin);
      await SecureStore.setItemAsync(SECURITY_KEYS.SECURITY_ENABLED, 'true');
      console.log('PIN saved successfully');
      return true;
    } catch (error) {
      console.error('Failed to save PIN:', error);
      return false;
    }
  }

  /**
   * Verify PIN
   */
  async verifyPin(pin: string): Promise<boolean> {
    try {
      const storedHash = await SecureStore.getItemAsync(SECURITY_KEYS.PIN_HASH);
      if (!storedHash) {
        console.warn('No PIN found in secure storage');
        return false;
      }

      const inputHash = this.hashPin(pin);
      return inputHash === storedHash;
    } catch (error) {
      console.error('Failed to verify PIN:', error);
      return false;
    }
  }

  /**
   * Enable/disable biometric authentication
   */
  async setBiometricEnabled(enabled: boolean): Promise<boolean> {
    try {
      await SecureStore.setItemAsync(
        SECURITY_KEYS.BIOMETRIC_ENABLED,
        enabled ? 'true' : 'false'
      );
      await SecureStore.setItemAsync(SECURITY_KEYS.SECURITY_ENABLED, 'true');
      console.log(`Biometric ${enabled ? 'enabled' : 'disabled'} successfully`);
      return true;
    } catch (error) {
      console.error('Failed to set biometric preference:', error);
      return false;
    }
  }

  /**
   * Check if biometric is enabled
   */
  async isBiometricEnabled(): Promise<boolean> {
    try {
      const value = await SecureStore.getItemAsync(SECURITY_KEYS.BIOMETRIC_ENABLED);
      return value === 'true';
    } catch (error) {
      console.error('Failed to check biometric status:', error);
      return false;
    }
  }

  /**
   * Check if any security is enabled
   */
  async isSecurityEnabled(): Promise<boolean> {
    try {
      const value = await SecureStore.getItemAsync(SECURITY_KEYS.SECURITY_ENABLED);
      return value === 'true';
    } catch (error) {
      console.error('Failed to check security status:', error);
      return false;
    }
  }

  /**
   * Get current security settings
   */
  async getSecuritySettings(): Promise<SecuritySettings> {
    try {
      const pinHash = await SecureStore.getItemAsync(SECURITY_KEYS.PIN_HASH);
      const biometricEnabled = await this.isBiometricEnabled();

      let biometricType: 'fingerprint' | 'face' | 'iris' | null = null;
      
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      
      if (compatible && enrolled) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          biometricType = 'face';
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          biometricType = 'fingerprint';
        } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
          biometricType = 'iris';
        }
      }

      return {
        pinEnabled: !!pinHash,
        biometricEnabled,
        biometricType,
      };
    } catch (error) {
      console.error('Failed to get security settings:', error);
      return {
        pinEnabled: false,
        biometricEnabled: false,
        biometricType: null,
      };
    }
  }

  /**
   * Authenticate user with biometric
   */
  async authenticateWithBiometric(
    promptMessage: string = 'Authenticate to access your wallet'
  ): Promise<boolean> {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();

      if (!compatible || !enrolled) {
        console.warn('Biometric authentication not available');
        return false;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        fallbackLabel: 'Use PIN',
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });

      return result.success;
    } catch (error) {
      console.error('Biometric authentication error:', error);
      return false;
    }
  }

  /**
   * Remove all security settings
   */
  async clearSecuritySettings(): Promise<boolean> {
    try {
      await SecureStore.deleteItemAsync(SECURITY_KEYS.PIN_HASH);
      await SecureStore.deleteItemAsync(SECURITY_KEYS.BIOMETRIC_ENABLED);
      await SecureStore.deleteItemAsync(SECURITY_KEYS.SECURITY_ENABLED);
      console.log('Security settings cleared');
      return true;
    } catch (error) {
      console.error('Failed to clear security settings:', error);
      return false;
    }
  }

  /**
   * Change PIN
   */
  async changePin(oldPin: string, newPin: string): Promise<boolean> {
    try {
      const isValid = await this.verifyPin(oldPin);
      if (!isValid) {
        console.warn('Old PIN is incorrect');
        return false;
      }

      return await this.savePin(newPin);
    } catch (error) {
      console.error('Failed to change PIN:', error);
      return false;
    }
  }

  /**
   * Check if biometric hardware is available
   */
  async checkBiometricAvailability(): Promise<{
    available: boolean;
    type: 'fingerprint' | 'face' | 'iris' | null;
  }> {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      
      if (!compatible || !enrolled) {
        return { available: false, type: null };
      }

      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      let type: 'fingerprint' | 'face' | 'iris' | null = null;

      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        type = 'face';
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        type = 'fingerprint';
      } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        type = 'iris';
      }

      return { available: true, type };
    } catch (error) {
      console.error('Failed to check biometric availability:', error);
      return { available: false, type: null };
    }
  }
}

export default SecurityService;

