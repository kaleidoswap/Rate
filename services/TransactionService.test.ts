// services/TransactionService.test.ts
import { TransactionService, PaymentRequest } from './TransactionService';
import DatabaseService from './DatabaseService';
import RGBApiService from './RGBApiService';

// Mock dependencies
jest.mock('./DatabaseService');
jest.mock('./RGBApiService');
jest.mock('./ErrorHandlingService');

describe('TransactionService', () => {
  let transactionService: TransactionService;
  let mockDbService: jest.Mocked<DatabaseService>;
  let mockRgbApiService: jest.Mocked<RGBApiService>;

  beforeEach(() => {
    transactionService = TransactionService.getInstance();
    mockDbService = DatabaseService.getInstance() as jest.Mocked<DatabaseService>;
    mockRgbApiService = RGBApiService.getInstance() as jest.Mocked<RGBApiService>;
    
    jest.clearAllMocks();
  });

  describe('sendPayment', () => {
    const walletId = 1;
    const paymentRequest: PaymentRequest = {
      amount: 10000,
      invoice: 'lnbc1000n1...',
      description: 'Test payment',
    };

    it('should create pending transaction and execute payment', async () => {
      const mockTransaction = {
        id: 1,
        txid: 'tx123',
        wallet_id: walletId,
        type: 'send',
        amount: 10000,
        status: 'pending',
        timestamp: Date.now(),
        description: 'Test payment',
      };

      mockDbService.addTransaction = jest.fn().mockResolvedValue(mockTransaction);
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);
      mockDbService.getTransaction = jest.fn().mockResolvedValue({
        ...mockTransaction,
        status: 'confirmed',
      });

      // Mock successful payment
      mockRgbApiService.sendPayment = jest.fn().mockResolvedValue({
        success: true,
        txid: 'tx123',
      });

      const result = await transactionService.sendPayment(walletId, paymentRequest);

      expect(result.success).toBe(true);
      expect(result.txid).toBe('tx123');
      expect(mockDbService.addTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet_id: walletId,
          type: 'send',
          amount: 10000,
          status: 'pending',
        })
      );
      expect(mockDbService.updateTransactionStatus).toHaveBeenCalledWith('tx123', 'confirmed');
    });

    it('should mark transaction as failed on payment error', async () => {
      const mockTransaction = {
        id: 1,
        txid: 'tx456',
        wallet_id: walletId,
        type: 'send',
        amount: 10000,
        status: 'pending',
        timestamp: Date.now(),
      };

      mockDbService.addTransaction = jest.fn().mockResolvedValue(mockTransaction);
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);

      // Mock failed payment
      mockRgbApiService.sendPayment = jest.fn().mockRejectedValue(new Error('Payment failed'));

      const result = await transactionService.sendPayment(walletId, paymentRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockDbService.updateTransactionStatus).toHaveBeenCalledWith('tx456', 'failed');
    });

    it('should retry payment on retryable errors', async () => {
      const mockTransaction = {
        id: 1,
        txid: 'tx789',
        wallet_id: walletId,
        type: 'send',
        amount: 10000,
        status: 'pending',
        timestamp: Date.now(),
      };

      mockDbService.addTransaction = jest.fn().mockResolvedValue(mockTransaction);
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);
      mockDbService.getTransaction = jest.fn().mockResolvedValue({
        ...mockTransaction,
        status: 'confirmed',
      });

      // Mock payment: fail twice, then succeed
      mockRgbApiService.sendPayment = jest.fn()
        .mockRejectedValueOnce(new Error('Network request failed'))
        .mockRejectedValueOnce(new Error('Network request failed'))
        .mockResolvedValueOnce({ success: true, txid: 'tx789' });

      const result = await transactionService.sendPayment(
        walletId,
        paymentRequest,
        { maxAttempts: 3, delayMs: 100, backoffMultiplier: 1.5 }
      );

      expect(result.success).toBe(true);
      expect(mockRgbApiService.sendPayment).toHaveBeenCalledTimes(3);
    });
  });

  describe('getTransactionHistory', () => {
    it('should retrieve transaction history for a wallet', async () => {
      const walletId = 1;
      const mockTransactions = [
        {
          id: 1,
          txid: 'tx1',
          wallet_id: walletId,
          type: 'receive',
          amount: 5000,
          status: 'confirmed',
          timestamp: Date.now(),
        },
        {
          id: 2,
          txid: 'tx2',
          wallet_id: walletId,
          type: 'send',
          amount: 3000,
          status: 'confirmed',
          timestamp: Date.now(),
        },
      ];

      mockDbService.getTransactionsByWallet = jest.fn().mockResolvedValue(mockTransactions);

      const result = await transactionService.getTransactionHistory(walletId);

      expect(result).toHaveLength(2);
      expect(mockDbService.getTransactionsByWallet).toHaveBeenCalledWith(walletId, 50);
    });

    it('should handle empty transaction history', async () => {
      mockDbService.getTransactionsByWallet = jest.fn().mockResolvedValue([]);

      const result = await transactionService.getTransactionHistory(1);

      expect(result).toHaveLength(0);
    });
  });

  describe('getPendingTransactions', () => {
    it('should retrieve only pending transactions', async () => {
      const walletId = 1;
      const mockPendingTx = [
        {
          id: 1,
          txid: 'tx_pending',
          wallet_id: walletId,
          type: 'send',
          amount: 2000,
          status: 'pending',
          timestamp: Date.now(),
        },
      ];

      mockDbService.getTransactionsByWalletAndStatus = jest.fn().mockResolvedValue(mockPendingTx);

      const result = await transactionService.getPendingTransactions(walletId);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
      expect(mockDbService.getTransactionsByWalletAndStatus).toHaveBeenCalledWith(
        walletId,
        'pending',
        50
      );
    });
  });

  describe('retryTransaction', () => {
    it('should retry a failed transaction', async () => {
      const txid = 'tx_failed';
      const mockTransaction = {
        id: 1,
        txid,
        wallet_id: 1,
        type: 'send',
        amount: 5000,
        status: 'failed',
        timestamp: Date.now(),
        invoice: 'lnbc5000n1...',
      };

      mockDbService.getTransactionByTxid = jest.fn().mockResolvedValue(mockTransaction);
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);
      mockDbService.getTransaction = jest.fn().mockResolvedValue({
        ...mockTransaction,
        status: 'confirmed',
      });

      mockRgbApiService.sendPayment = jest.fn().mockResolvedValue({
        success: true,
        txid,
      });

      const result = await transactionService.retryTransaction(txid);

      expect(result.success).toBe(true);
      expect(mockDbService.updateTransactionStatus).toHaveBeenCalledWith(txid, 'pending');
      expect(mockDbService.updateTransactionStatus).toHaveBeenCalledWith(txid, 'confirmed');
    });

    it('should fail if transaction not found', async () => {
      mockDbService.getTransactionByTxid = jest.fn().mockResolvedValue(null);

      const result = await transactionService.retryTransaction('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail if transaction is not failed', async () => {
      const mockTransaction = {
        id: 1,
        txid: 'tx_confirmed',
        wallet_id: 1,
        type: 'send',
        amount: 5000,
        status: 'confirmed',
        timestamp: Date.now(),
      };

      mockDbService.getTransactionByTxid = jest.fn().mockResolvedValue(mockTransaction);

      const result = await transactionService.retryTransaction('tx_confirmed');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot retry');
    });
  });

  describe('cleanupOldPendingTransactions', () => {
    it('should delete old pending transactions', async () => {
      const now = Date.now();
      const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

      mockDbService.deletePendingTransactionsOlderThan = jest.fn().mockResolvedValue(undefined);

      await transactionService.cleanupOldPendingTransactions(twentyFourHoursAgo);

      expect(mockDbService.deletePendingTransactionsOlderThan).toHaveBeenCalledWith(
        twentyFourHoursAgo
      );
    });
  });

  describe('getTransactionByTxid', () => {
    it('should retrieve transaction by txid', async () => {
      const mockTransaction = {
        id: 1,
        txid: 'tx123',
        wallet_id: 1,
        type: 'send',
        amount: 1000,
        status: 'confirmed',
        timestamp: Date.now(),
      };

      mockDbService.getTransactionByTxid = jest.fn().mockResolvedValue(mockTransaction);

      const result = await transactionService.getTransactionByTxid('tx123');

      expect(result).toEqual(mockTransaction);
      expect(mockDbService.getTransactionByTxid).toHaveBeenCalledWith('tx123');
    });

    it('should return null for non-existent transaction', async () => {
      mockDbService.getTransactionByTxid = jest.fn().mockResolvedValue(null);

      const result = await transactionService.getTransactionByTxid('nonexistent');

      expect(result).toBeNull();
    });
  });
});

