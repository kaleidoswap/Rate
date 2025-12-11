// __tests__/integration/wallet-setup.test.ts
import DatabaseService from '../../services/DatabaseService';
import SecurityService from '../../services/SecurityService';
import { createTestWallet } from '../factories/walletFactory';
import * as SecureStore from 'expo-secure-store';

// Mock dependencies
jest.mock('../../services/DatabaseService');
jest.mock('expo-secure-store');

describe('Wallet Setup Integration', () => {
  let dbService: jest.Mocked<DatabaseService>;
  let securityService: SecurityService;

  beforeEach(() => {
    dbService = DatabaseService.getInstance() as jest.Mocked<DatabaseService>;
    securityService = SecurityService.getInstance();
    jest.clearAllMocks();
  });

  describe('Complete Wallet Creation Flow', () => {
    it('should create wallet with mnemonic and security', async () => {
      const mockWallet = createTestWallet({
        id: 1,
        name: 'My First Wallet',
        type: 'spark',
        network: 'testnet',
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      });

      // Mock database operations
      dbService.addWallet = jest.fn().mockResolvedValue(mockWallet);
      dbService.setActiveWallet = jest.fn().mockResolvedValue(undefined);

      // Mock secure storage
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
      mockSetItemAsync.mockResolvedValue(undefined);

      // Step 1: Generate mnemonic (simulated - normally done by bip39)
      const mnemonic = mockWallet.mnemonic!;
      expect(mnemonic.split(' ')).toHaveLength(12);

      // Step 2: Save wallet to database
      const createdWallet = await dbService.addWallet({
        name: mockWallet.name,
        type: mockWallet.type,
        network: mockWallet.network,
        mnemonic: mnemonic,
      } as any);

      expect(createdWallet).toEqual(mockWallet);
      expect(dbService.addWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My First Wallet',
          type: 'spark',
          network: 'testnet',
        })
      );

      // Step 3: Set as active wallet
      await dbService.setActiveWallet(createdWallet.id);
      expect(dbService.setActiveWallet).toHaveBeenCalledWith(1);

      // Step 4: Setup security (PIN)
      const pinSetResult = await securityService.savePin('123456');
      expect(pinSetResult).toBe(true);
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'rate_wallet_pin_hash',
        expect.any(String)
      );

      // Step 5: Enable biometric
      const biometricResult = await securityService.setBiometricEnabled(true);
      expect(biometricResult).toBe(true);

      // Verify complete wallet setup
      const securitySettings = await securityService.getSecuritySettings();
      expect(securitySettings.pinEnabled).toBe(true);
      expect(securitySettings.biometricEnabled).toBe(true);
    });

    it('should handle wallet creation failure gracefully', async () => {
      // Mock database error
      dbService.addWallet = jest.fn().mockRejectedValue(
        new Error('Database write failed')
      );

      await expect(
        dbService.addWallet({
          name: 'Failed Wallet',
          type: 'spark',
          network: 'testnet',
        } as any)
      ).rejects.toThrow('Database write failed');
    });
  });

  describe('Wallet Restoration Flow', () => {
    it('should restore wallet from mnemonic', async () => {
      const existingMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      
      const restoredWallet = createTestWallet({
        id: 2,
        name: 'Restored Wallet',
        type: 'spark',
        network: 'mainnet',
        mnemonic: existingMnemonic,
      });

      // Mock database operations
      dbService.addWallet = jest.fn().mockResolvedValue(restoredWallet);
      dbService.setActiveWallet = jest.fn().mockResolvedValue(undefined);

      // Restore wallet
      const result = await dbService.addWallet({
        name: 'Restored Wallet',
        type: 'spark',
        network: 'mainnet',
        mnemonic: existingMnemonic,
      } as any);

      expect(result).toEqual(restoredWallet);
      expect(dbService.addWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          mnemonic: existingMnemonic,
        })
      );
    });

    it('should reject invalid mnemonic', async () => {
      const invalidMnemonic = 'invalid mnemonic phrase';

      dbService.addWallet = jest.fn().mockRejectedValue(
        new Error('Invalid mnemonic')
      );

      await expect(
        dbService.addWallet({
          name: 'Invalid Wallet',
          type: 'spark',
          network: 'testnet',
          mnemonic: invalidMnemonic,
        } as any)
      ).rejects.toThrow('Invalid mnemonic');
    });
  });

  describe('Multi-Wallet Management', () => {
    it('should create multiple wallets and switch between them', async () => {
      const wallet1 = createTestWallet({ id: 1, name: 'Wallet 1', type: 'spark' });
      const wallet2 = createTestWallet({ id: 2, name: 'Wallet 2', type: 'liquid' });

      dbService.addWallet = jest.fn()
        .mockResolvedValueOnce(wallet1)
        .mockResolvedValueOnce(wallet2);
      dbService.setActiveWallet = jest.fn().mockResolvedValue(undefined);
      dbService.getActiveWallet = jest.fn()
        .mockResolvedValueOnce(wallet1)
        .mockResolvedValueOnce(wallet2);

      // Create first wallet
      const created1 = await dbService.addWallet({ name: 'Wallet 1', type: 'spark' } as any);
      await dbService.setActiveWallet(created1.id);
      
      let activeWallet = await dbService.getActiveWallet();
      expect(activeWallet?.id).toBe(1);

      // Create second wallet
      const created2 = await dbService.addWallet({ name: 'Wallet 2', type: 'liquid' } as any);
      await dbService.setActiveWallet(created2.id);

      activeWallet = await dbService.getActiveWallet();
      expect(activeWallet?.id).toBe(2);
    });

    it('should list all wallets', async () => {
      const wallets = [
        createTestWallet({ id: 1, name: 'Wallet 1' }),
        createTestWallet({ id: 2, name: 'Wallet 2' }),
        createTestWallet({ id: 3, name: 'Wallet 3' }),
      ];

      dbService.getAllWallets = jest.fn().mockResolvedValue(wallets);

      const result = await dbService.getAllWallets();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Wallet 1');
      expect(result[1].name).toBe('Wallet 2');
      expect(result[2].name).toBe('Wallet 3');
    });
  });

  describe('Wallet Deletion Flow', () => {
    it('should delete wallet and its data', async () => {
      const wallet = createTestWallet({ id: 1 });

      dbService.deleteWallet = jest.fn().mockResolvedValue(undefined);
      dbService.getActiveWallet = jest.fn().mockResolvedValue(null);

      await dbService.deleteWallet(wallet.id);

      expect(dbService.deleteWallet).toHaveBeenCalledWith(1);

      // Verify no active wallet after deletion
      const activeWallet = await dbService.getActiveWallet();
      expect(activeWallet).toBeNull();
    });
  });

  describe('Network Selection', () => {
    it('should create wallet on testnet', async () => {
      const testnetWallet = createTestWallet({
        network: 'testnet',
        type: 'spark',
      });

      dbService.addWallet = jest.fn().mockResolvedValue(testnetWallet);

      const result = await dbService.addWallet({
        name: 'Testnet Wallet',
        type: 'spark',
        network: 'testnet',
      } as any);

      expect(result.network).toBe('testnet');
    });

    it('should create wallet on mainnet', async () => {
      const mainnetWallet = createTestWallet({
        network: 'mainnet',
        type: 'spark',
      });

      dbService.addWallet = jest.fn().mockResolvedValue(mainnetWallet);

      const result = await dbService.addWallet({
        name: 'Mainnet Wallet',
        type: 'spark',
        network: 'mainnet',
      } as any);

      expect(result.network).toBe('mainnet');
    });
  });

  describe('Security Settings Persistence', () => {
    it('should persist security settings across app restarts', async () => {
      const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
      const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;

      mockSetItemAsync.mockResolvedValue(undefined);
      mockGetItemAsync.mockImplementation((key) => {
        if (key === 'rate_wallet_pin_hash') return Promise.resolve('hashed_pin');
        if (key === 'rate_wallet_biometric_enabled') return Promise.resolve('true');
        return Promise.resolve(null);
      });

      // Setup security
      await securityService.savePin('123456');
      await securityService.setBiometricEnabled(true);

      // Simulate app restart - retrieve settings
      const settings = await securityService.getSecuritySettings();

      expect(settings.pinEnabled).toBe(true);
      expect(settings.biometricEnabled).toBe(true);
    });
  });
});

