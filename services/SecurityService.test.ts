// services/SecurityService.test.ts
import SecurityService from './SecurityService';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

// Mock modules
jest.mock('expo-secure-store');
jest.mock('expo-local-authentication');

describe('SecurityService', () => {
  let securityService: SecurityService;

  beforeEach(() => {
    securityService = SecurityService.getInstance();
    jest.clearAllMocks();
  });

  describe('savePin', () => {
    it('should hash and save PIN to secure storage', async () => {
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      mockSetItemAsync.mockResolvedValue(undefined);

      const result = await securityService.savePin('123456');

      expect(result).toBe(true);
      expect(mockSetItemAsync).toHaveBeenCalledTimes(2);
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'rate_wallet_pin_hash',
        expect.any(String)
      );
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'rate_wallet_security_enabled',
        'true'
      );
    });

    it('should return false on storage error', async () => {
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      mockSetItemAsync.mockRejectedValue(new Error('Storage error'));

      const result = await securityService.savePin('123456');

      expect(result).toBe(false);
    });

    it('should hash different PINs differently', async () => {
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      const hashes: string[] = [];

      mockSetItemAsync.mockImplementation((key, value) => {
        if (key === 'rate_wallet_pin_hash') {
          hashes.push(value);
        }
        return Promise.resolve();
      });

      await securityService.savePin('123456');
      await securityService.savePin('654321');

      expect(hashes[0]).not.toBe(hashes[1]);
    });
  });

  describe('verifyPin', () => {
    it('should verify correct PIN', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      
      let storedHash: string = '';
      mockSetItemAsync.mockImplementation((key, value) => {
        if (key === 'rate_wallet_pin_hash') {
          storedHash = value;
        }
        return Promise.resolve();
      });
      mockGetItemAsync.mockImplementation((key) => {
        if (key === 'rate_wallet_pin_hash') {
          return Promise.resolve(storedHash);
        }
        return Promise.resolve(null);
      });

      await securityService.savePin('123456');
      const result = await securityService.verifyPin('123456');

      expect(result).toBe(true);
    });

    it('should reject incorrect PIN', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      
      let storedHash: string = '';
      mockSetItemAsync.mockImplementation((key, value) => {
        if (key === 'rate_wallet_pin_hash') {
          storedHash = value;
        }
        return Promise.resolve();
      });
      mockGetItemAsync.mockImplementation((key) => {
        if (key === 'rate_wallet_pin_hash') {
          return Promise.resolve(storedHash);
        }
        return Promise.resolve(null);
      });

      await securityService.savePin('123456');
      const result = await securityService.verifyPin('654321');

      expect(result).toBe(false);
    });

    it('should return false when no PIN is stored', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      mockGetItemAsync.mockResolvedValue(null);

      const result = await securityService.verifyPin('123456');

      expect(result).toBe(false);
    });

    it('should handle verification errors', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      mockGetItemAsync.mockRejectedValue(new Error('Storage error'));

      const result = await securityService.verifyPin('123456');

      expect(result).toBe(false);
    });
  });

  describe('setBiometricEnabled', () => {
    it('should save biometric preference', async () => {
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      mockSetItemAsync.mockResolvedValue(undefined);

      const result = await securityService.setBiometricEnabled(true);

      expect(result).toBe(true);
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'rate_wallet_biometric_enabled',
        'true'
      );
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'rate_wallet_security_enabled',
        'true'
      );
    });

    it('should handle disable biometric', async () => {
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      mockSetItemAsync.mockResolvedValue(undefined);

      const result = await securityService.setBiometricEnabled(false);

      expect(result).toBe(true);
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'rate_wallet_biometric_enabled',
        'false'
      );
    });
  });

  describe('isBiometricEnabled', () => {
    it('should return true when biometric is enabled', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      mockGetItemAsync.mockResolvedValue('true');

      const result = await securityService.isBiometricEnabled();

      expect(result).toBe(true);
    });

    it('should return false when biometric is disabled', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      mockGetItemAsync.mockResolvedValue('false');

      const result = await securityService.isBiometricEnabled();

      expect(result).toBe(false);
    });
  });

  describe('getSecuritySettings', () => {
    it('should return complete security settings', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      mockGetItemAsync.mockImplementation((key) => {
        if (key === 'rate_wallet_pin_hash') return Promise.resolve('hash');
        if (key === 'rate_wallet_biometric_enabled') return Promise.resolve('true');
        return Promise.resolve(null);
      });

      const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
      const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
      const mockSupportedTypes = LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock;

      mockHasHardware.mockResolvedValue(true);
      mockIsEnrolled.mockResolvedValue(true);
      mockSupportedTypes.mockResolvedValue([LocalAuthentication.AuthenticationType.FINGERPRINT]);

      const settings = await securityService.getSecuritySettings();

      expect(settings.pinEnabled).toBe(true);
      expect(settings.biometricEnabled).toBe(true);
      expect(settings.biometricType).toBe('fingerprint');
    });

    it('should detect Face ID', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      mockGetItemAsync.mockResolvedValue('false');

      const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
      const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
      const mockSupportedTypes = LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock;

      mockHasHardware.mockResolvedValue(true);
      mockIsEnrolled.mockResolvedValue(true);
      mockSupportedTypes.mockResolvedValue([LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION]);

      const settings = await securityService.getSecuritySettings();

      expect(settings.biometricType).toBe('face');
    });
  });

  describe('authenticateWithBiometric', () => {
    it('should authenticate successfully', async () => {
      const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
      const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
      const mockAuthenticate = LocalAuthentication.authenticateAsync as jest.Mock;

      mockHasHardware.mockResolvedValue(true);
      mockIsEnrolled.mockResolvedValue(true);
      mockAuthenticate.mockResolvedValue({ success: true });

      const result = await securityService.authenticateWithBiometric();

      expect(result).toBe(true);
      expect(mockAuthenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          promptMessage: 'Authenticate to access your wallet',
        })
      );
    });

    it('should fail when biometric not available', async () => {
      const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
      mockHasHardware.mockResolvedValue(false);

      const result = await securityService.authenticateWithBiometric();

      expect(result).toBe(false);
    });

    it('should fail when authentication fails', async () => {
      const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
      const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
      const mockAuthenticate = LocalAuthentication.authenticateAsync as jest.Mock;

      mockHasHardware.mockResolvedValue(true);
      mockIsEnrolled.mockResolvedValue(true);
      mockAuthenticate.mockResolvedValue({ success: false });

      const result = await securityService.authenticateWithBiometric();

      expect(result).toBe(false);
    });
  });

  describe('clearSecuritySettings', () => {
    it('should remove all security settings', async () => {
      const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;
      mockDeleteItemAsync.mockResolvedValue(undefined);

      const result = await securityService.clearSecuritySettings();

      expect(result).toBe(true);
      expect(mockDeleteItemAsync).toHaveBeenCalledTimes(3);
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('rate_wallet_pin_hash');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('rate_wallet_biometric_enabled');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('rate_wallet_security_enabled');
    });
  });

  describe('changePin', () => {
    it('should change PIN when old PIN is correct', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      
      let storedHash: string = '';
      mockSetItemAsync.mockImplementation((key, value) => {
        if (key === 'rate_wallet_pin_hash') {
          storedHash = value;
        }
        return Promise.resolve();
      });
      mockGetItemAsync.mockImplementation((key) => {
        if (key === 'rate_wallet_pin_hash') {
          return Promise.resolve(storedHash);
        }
        return Promise.resolve(null);
      });

      await securityService.savePin('123456');
      const result = await securityService.changePin('123456', '654321');

      expect(result).toBe(true);
    });

    it('should fail when old PIN is incorrect', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      
      let storedHash: string = '';
      mockSetItemAsync.mockImplementation((key, value) => {
        if (key === 'rate_wallet_pin_hash') {
          storedHash = value;
        }
        return Promise.resolve();
      });
      mockGetItemAsync.mockImplementation((key) => {
        if (key === 'rate_wallet_pin_hash') {
          return Promise.resolve(storedHash);
        }
        return Promise.resolve(null);
      });

      await securityService.savePin('123456');
      const result = await securityService.changePin('wrong', '654321');

      expect(result).toBe(false);
    });
  });

  describe('checkBiometricAvailability', () => {
    it('should detect fingerprint availability', async () => {
      const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
      const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
      const mockSupportedTypes = LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock;

      mockHasHardware.mockResolvedValue(true);
      mockIsEnrolled.mockResolvedValue(true);
      mockSupportedTypes.mockResolvedValue([LocalAuthentication.AuthenticationType.FINGERPRINT]);

      const result = await securityService.checkBiometricAvailability();

      expect(result.available).toBe(true);
      expect(result.type).toBe('fingerprint');
    });

    it('should return unavailable when hardware missing', async () => {
      const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
      mockHasHardware.mockResolvedValue(false);

      const result = await securityService.checkBiometricAvailability();

      expect(result.available).toBe(false);
      expect(result.type).toBe(null);
    });

    it('should return unavailable when not enrolled', async () => {
      const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
      const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;

      mockHasHardware.mockResolvedValue(true);
      mockIsEnrolled.mockResolvedValue(false);

      const result = await securityService.checkBiometricAvailability();

      expect(result.available).toBe(false);
      expect(result.type).toBe(null);
    });
  });
});

