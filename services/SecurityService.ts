// services/SecurityService.ts
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import CryptoJS from 'crypto-js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

const SECURITY_KEYS = {
  PIN_HASH: 'rate_wallet_pin_hash',
  BIOMETRIC_ENABLED: 'rate_wallet_biometric_enabled',
  SECURITY_ENABLED: 'rate_wallet_security_enabled',
  // Per-wallet seed phrase lives in the OS secure enclave, keyed by wallet id.
  MNEMONIC_PREFIX: 'rate_wallet_mnemonic_',
};

const MNEMONIC_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  // Keep seeds device-bound and unavailable while the device is locked. We do
  // not use requireAuthentication here yet because normal wallet startup still
  // reads the seed for protocol initialization.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// PIN hashes are stored as `pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>`.
// The hash already lives in the Keychain/Keystore; the salt defeats
// precomputed tables and the work factor slows brute force of an extracted
// hash. 10k iterations keeps unlock responsive on Hermes (no JIT); the count is
// stored per hash, so raising it later re-hashes on the next successful unlock.
const PIN_HASH_SCHEME = 'pbkdf2-sha256';
const PIN_HASH_ITERATIONS = 10_000;

async function derivePinHash(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await pbkdf2Async(sha256, pin, salt, { c: iterations, dkLen: 32 });
  return bytesToHex(key);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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
   * Hash a PIN with a fresh random salt (PBKDF2-SHA256).
   */
  private async hashPin(pin: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await derivePinHash(pin, salt, PIN_HASH_ITERATIONS);
    return `${PIN_HASH_SCHEME}$${PIN_HASH_ITERATIONS}$${bytesToHex(salt)}$${hash}`;
  }

  /**
   * Check a PIN against a stored hash. Also accepts the legacy unsalted
   * SHA-256 format written by older builds; `needsRehash` tells the caller to
   * upgrade it.
   */
  private async checkPinHash(pin: string, stored: string): Promise<{ ok: boolean; needsRehash: boolean }> {
    const parts = stored.split('$');
    if (parts.length === 4 && parts[0] === PIN_HASH_SCHEME) {
      const iterations = Number(parts[1]);
      if (!Number.isInteger(iterations) || iterations <= 0) return { ok: false, needsRehash: false };
      const hash = await derivePinHash(pin, hexToBytes(parts[2]), iterations);
      return { ok: constantTimeEqual(hash, parts[3]), needsRehash: iterations < PIN_HASH_ITERATIONS };
    }
    const legacy = CryptoJS.SHA256(pin).toString();
    return { ok: constantTimeEqual(legacy, stored), needsRehash: true };
  }

  /**
   * Save PIN securely
   */
  async savePin(pin: string): Promise<boolean> {
    try {
      const hashedPin = await this.hashPin(pin);
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

      const { ok, needsRehash } = await this.checkPinHash(pin, storedHash);
      if (ok && needsRehash) {
        // Upgrade legacy / weaker hashes now that we know the PIN.
        try {
          await SecureStore.setItemAsync(SECURITY_KEYS.PIN_HASH, await this.hashPin(pin));
        } catch (e) {
          console.warn('Failed to upgrade PIN hash:', e);
        }
      }
      return ok;
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

  // -------------------------------------------------------------------------
  // Seed vault — the BIP39 mnemonic is kept in the OS secure enclave (iOS
  // Keychain / Android Keystore-backed storage), never in the app's SQLite file.
  // -------------------------------------------------------------------------

  private mnemonicKey(walletId: number): string {
    return `${SECURITY_KEYS.MNEMONIC_PREFIX}${walletId}`;
  }

  /** Store a wallet's seed phrase in the secure enclave. */
  async storeMnemonic(walletId: number, mnemonic: string): Promise<boolean> {
    try {
      await SecureStore.setItemAsync(this.mnemonicKey(walletId), mnemonic, MNEMONIC_STORE_OPTIONS);
      return true;
    } catch (error) {
      console.error('Failed to store mnemonic securely:', error);
      return false;
    }
  }

  /** Read a wallet's seed phrase from the secure enclave (null if absent). */
  async getMnemonic(walletId: number): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(this.mnemonicKey(walletId), MNEMONIC_STORE_OPTIONS);
    } catch (error) {
      console.error('Failed to read mnemonic from secure storage:', error);
      return null;
    }
  }

  /**
   * Authenticated recovery path for UI reveal. Callers should use this instead
   * of getMnemonic whenever plaintext words are shown to the user.
   */
  async revealMnemonic(walletId: number): Promise<string | null> {
    const canAuth = await this.isDeviceAuthAvailable();
    if (!canAuth) {
      throw new Error('Set a device passcode or biometric lock before revealing your recovery phrase.');
    }

    const authenticated = await this.authenticateForReveal();
    if (!authenticated) return null;

    return this.getMnemonic(walletId);
  }

  /** Remove a wallet's seed phrase from the secure enclave. */
  async deleteMnemonic(walletId: number): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(this.mnemonicKey(walletId));
    } catch (error) {
      console.error('Failed to delete mnemonic from secure storage:', error);
    }
  }

  /** True when the device can challenge the user (biometric or device passcode). */
  async isDeviceAuthAvailable(): Promise<boolean> {
    try {
      const getEnrolledLevel = (LocalAuthentication as any).getEnrolledLevelAsync;
      if (typeof getEnrolledLevel === 'function') {
        const level = await getEnrolledLevel();
        return level > LocalAuthentication.SecurityLevel.NONE;
      }

      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      return hasHardware && enrolled;
    } catch {
      return false;
    }
  }

  /**
   * Strong gate for revealing the seed phrase. Requires biometric OR device
   * passcode (device fallback enabled). Returns false on cancel/failure.
   */
  async authenticateForReveal(
    promptMessage = 'Authenticate to reveal your recovery phrase',
  ): Promise<boolean> {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      return result.success;
    } catch (error) {
      console.error('Reveal authentication error:', error);
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
