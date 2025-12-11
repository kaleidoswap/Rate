// __tests__/integration/payment-flow.test.ts
import { TransactionService } from '../../services/TransactionService';
import DatabaseService from '../../services/DatabaseService';
import RGBApiService from '../../services/RGBApiService';
import ErrorHandlingService from '../../services/ErrorHandlingService';
import { createTestTransaction } from '../factories/transactionFactory';
import { createTestWallet } from '../factories/walletFactory';

// Mock dependencies
jest.mock('../../services/DatabaseService');
jest.mock('../../services/RGBApiService');
jest.mock('../../services/ErrorHandlingService');

describe('Payment Flow Integration', () => {
  let transactionService: TransactionService;
  let mockDbService: jest.Mocked<DatabaseService>;
  let mockRgbApiService: jest.Mocked<RGBApiService>;

  beforeEach(() => {
    transactionService = TransactionService.getInstance();
    mockDbService = DatabaseService.getInstance() as jest.Mocked<DatabaseService>;
    mockRgbApiService = RGBApiService.getInstance() as jest.Mocked<RGBApiService>;
    
    jest.clearAllMocks();
  });

  describe('Complete Lightning Payment Flow', () => {
    it('should successfully create, execute, and persist Lightning payment', async () => {
      const wallet = createTestWallet({ id: 1 });
      const paymentRequest = {
        amount: 10000,
        invoice: 'lnbc10000n1pj9...',
        description: 'Test Lightning payment',
      };

      // Mock database responses
      const pendingTx = createTestTransaction({
        txid: 'tx_lightning_123',
        wallet_id: wallet.id,
        type: 'send',
        amount: 10000,
        status: 'pending',
        invoice: paymentRequest.invoice,
      });

      mockDbService.addTransaction = jest.fn().mockResolvedValue(pendingTx);
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);
      mockDbService.getTransaction = jest.fn().mockResolvedValue({
        ...pendingTx,
        status: 'confirmed',
      });

      // Mock successful payment
      mockRgbApiService.sendPayment = jest.fn().mockResolvedValue({
        success: true,
        txid: 'tx_lightning_123',
      });

      // Execute payment
      const result = await transactionService.sendPayment(wallet.id, paymentRequest);

      // Verify result
      expect(result.success).toBe(true);
      expect(result.txid).toBe('tx_lightning_123');

      // Verify transaction was created as pending
      expect(mockDbService.addTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet_id: wallet.id,
          type: 'send',
          amount: 10000,
          status: 'pending',
        })
      );

      // Verify payment was executed
      expect(mockRgbApiService.sendPayment).toHaveBeenCalled();

      // Verify transaction was marked as confirmed
      expect(mockDbService.updateTransactionStatus).toHaveBeenCalledWith(
        'tx_lightning_123',
        'confirmed'
      );
    });

    it('should handle invoice decoding', async () => {
      const wallet = createTestWallet({ id: 1 });
      const invoice = 'lnbc10000n1pj9...';

      mockDbService.addTransaction = jest.fn().mockResolvedValue(
        createTestTransaction({ txid: 'tx_123', wallet_id: wallet.id })
      );
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);
      mockDbService.getTransaction = jest.fn().mockResolvedValue(
        createTestTransaction({ txid: 'tx_123', status: 'confirmed' })
      );

      mockRgbApiService.sendPayment = jest.fn().mockResolvedValue({
        success: true,
        txid: 'tx_123',
      });

      const result = await transactionService.sendPayment(wallet.id, {
        amount: 0, // Amount from invoice
        invoice,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Failed Payment Retry Logic', () => {
    it('should retry payment on network failure', async () => {
      const wallet = createTestWallet({ id: 1 });
      const paymentRequest = {
        amount: 5000,
        invoice: 'lnbc5000n1pj9...',
      };

      mockDbService.addTransaction = jest.fn().mockResolvedValue(
        createTestTransaction({ txid: 'tx_retry', wallet_id: wallet.id })
      );
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);
      mockDbService.getTransaction = jest.fn().mockResolvedValue(
        createTestTransaction({ txid: 'tx_retry', status: 'confirmed' })
      );

      // Mock payment: fail twice with network error, then succeed
      mockRgbApiService.sendPayment = jest.fn()
        .mockRejectedValueOnce(new Error('Network request failed'))
        .mockRejectedValueOnce(new Error('Network request failed'))
        .mockResolvedValueOnce({ success: true, txid: 'tx_retry' });

      const result = await transactionService.sendPayment(
        wallet.id,
        paymentRequest,
        { maxAttempts: 3, delayMs: 100, backoffMultiplier: 1.5 }
      );

      expect(result.success).toBe(true);
      expect(mockRgbApiService.sendPayment).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retry attempts', async () => {
      const wallet = createTestWallet({ id: 1 });
      const paymentRequest = {
        amount: 5000,
        invoice: 'lnbc5000n1pj9...',
      };

      mockDbService.addTransaction = jest.fn().mockResolvedValue(
        createTestTransaction({ txid: 'tx_fail', wallet_id: wallet.id })
      );
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);

      // Mock payment always fails
      mockRgbApiService.sendPayment = jest.fn().mockRejectedValue(
        new Error('Network request failed')
      );

      const result = await transactionService.sendPayment(
        wallet.id,
        paymentRequest,
        { maxAttempts: 3, delayMs: 100, backoffMultiplier: 1.5 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockRgbApiService.sendPayment).toHaveBeenCalledTimes(3);
      
      // Verify transaction was marked as failed
      expect(mockDbService.updateTransactionStatus).toHaveBeenCalledWith(
        'tx_fail',
        'failed'
      );
    });

    it('should not retry on non-retryable errors', async () => {
      const wallet = createTestWallet({ id: 1 });
      const paymentRequest = {
        amount: 5000,
        invoice: 'lnbc5000n1pj9...',
      };

      mockDbService.addTransaction = jest.fn().mockResolvedValue(
        createTestTransaction({ txid: 'tx_no_retry', wallet_id: wallet.id })
      );
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);

      // Mock payment fails with insufficient balance (non-retryable)
      mockRgbApiService.sendPayment = jest.fn().mockRejectedValue(
        new Error('Insufficient balance')
      );

      const result = await transactionService.sendPayment(
        wallet.id,
        paymentRequest,
        { maxAttempts: 3, delayMs: 100, backoffMultiplier: 1.5 }
      );

      expect(result.success).toBe(false);
      // Should only attempt once (no retries for non-retryable errors)
      expect(mockRgbApiService.sendPayment).toHaveBeenCalledTimes(1);
    });
  });

  describe('Transaction Status Monitoring', () => {
    it('should track pending transactions', async () => {
      const wallet = createTestWallet({ id: 1 });
      const pendingTxs = [
        createTestTransaction({ txid: 'tx_1', status: 'pending', wallet_id: wallet.id }),
        createTestTransaction({ txid: 'tx_2', status: 'pending', wallet_id: wallet.id }),
      ];

      mockDbService.getTransactionsByWalletAndStatus = jest.fn().mockResolvedValue(pendingTxs);

      const result = await transactionService.getPendingTransactions(wallet.id);

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('pending');
      expect(result[1].status).toBe('pending');
    });

    it('should cleanup old pending transactions', async () => {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

      mockDbService.deletePendingTransactionsOlderThan = jest.fn().mockResolvedValue(undefined);

      await transactionService.cleanupOldPendingTransactions(oneDayAgo);

      expect(mockDbService.deletePendingTransactionsOlderThan).toHaveBeenCalledWith(oneDayAgo);
    });
  });

  describe('Manual Transaction Retry', () => {
    it('should manually retry a failed transaction', async () => {
      const failedTx = createTestTransaction({
        txid: 'tx_manual_retry',
        wallet_id: 1,
        status: 'failed',
        invoice: 'lnbc5000n1pj9...',
      });

      mockDbService.getTransactionByTxid = jest.fn().mockResolvedValue(failedTx);
      mockDbService.updateTransactionStatus = jest.fn().mockResolvedValue(undefined);
      mockDbService.getTransaction = jest.fn().mockResolvedValue({
        ...failedTx,
        status: 'confirmed',
      });

      mockRgbApiService.sendPayment = jest.fn().mockResolvedValue({
        success: true,
        txid: 'tx_manual_retry',
      });

      const result = await transactionService.retryTransaction('tx_manual_retry');

      expect(result.success).toBe(true);
      expect(mockDbService.updateTransactionStatus).toHaveBeenCalledWith(
        'tx_manual_retry',
        'pending'
      );
      expect(mockDbService.updateTransactionStatus).toHaveBeenCalledWith(
        'tx_manual_retry',
        'confirmed'
      );
    });

    it('should fail to retry non-failed transaction', async () => {
      const confirmedTx = createTestTransaction({
        txid: 'tx_confirmed',
        status: 'confirmed',
      });

      mockDbService.getTransactionByTxid = jest.fn().mockResolvedValue(confirmedTx);

      const result = await transactionService.retryTransaction('tx_confirmed');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot retry');
    });
  });

  describe('Transaction History', () => {
    it('should retrieve complete transaction history', async () => {
      const wallet = createTestWallet({ id: 1 });
      const transactions = [
        createTestTransaction({ txid: 'tx_1', wallet_id: wallet.id }),
        createTestTransaction({ txid: 'tx_2', wallet_id: wallet.id }),
        createTestTransaction({ txid: 'tx_3', wallet_id: wallet.id }),
      ];

      mockDbService.getTransactionsByWallet = jest.fn().mockResolvedValue(transactions);

      const result = await transactionService.getTransactionHistory(wallet.id);

      expect(result).toHaveLength(3);
      expect(mockDbService.getTransactionsByWallet).toHaveBeenCalledWith(wallet.id, 50);
    });

    it('should retrieve transaction by txid', async () => {
      const transaction = createTestTransaction({ txid: 'tx_specific' });

      mockDbService.getTransactionByTxid = jest.fn().mockResolvedValue(transaction);

      const result = await transactionService.getTransactionByTxid('tx_specific');

      expect(result).toEqual(transaction);
      expect(mockDbService.getTransactionByTxid).toHaveBeenCalledWith('tx_specific');
    });
  });
});

