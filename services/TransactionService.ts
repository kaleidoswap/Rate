// services/TransactionService.ts
import DatabaseService, { TransactionRecord } from './DatabaseService';
import RGBApiService from './RGBApiService';
import ErrorHandlingService, { ErrorType } from './ErrorHandlingService';

export interface PaymentRequest {
  amount: number;
  address?: string;
  invoice?: string;
  assetId?: string;
  description?: string;
  feeRate?: number;
  isRGB?: boolean;
}

export interface PaymentResult {
  success: boolean;
  txid?: string;
  error?: string;
  transaction?: TransactionRecord;
}

export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 2000,
  backoffMultiplier: 2,
};

export class TransactionService {
  private static instance: TransactionService;
  private dbService: DatabaseService;
  private rgbApiService: RGBApiService;
  private errorHandler: ErrorHandlingService;
  private pendingRetries: Map<string, RetryConfig> = new Map();

  private constructor() {
    this.dbService = DatabaseService.getInstance();
    this.rgbApiService = RGBApiService.getInstance();
    this.errorHandler = ErrorHandlingService.getInstance();
  }

  public static getInstance(): TransactionService {
    if (!TransactionService.instance) {
      TransactionService.instance = new TransactionService();
    }
    return TransactionService.instance;
  }

  /**
   * Send payment with automatic retry and persistence
   */
  async sendPayment(
    walletId: number,
    request: PaymentRequest,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<PaymentResult> {
    try {
      // Create pending transaction record
      const transaction = await this.createPendingTransaction(
        walletId,
        request,
        'send'
      );

      // Attempt payment with retry logic
      const result = await this.executePaymentWithRetry(
        request,
        transaction.txid!,
        retryConfig
      );

      if (result.success && result.txid) {
        // Update transaction as confirmed
        await this.dbService.updateTransactionStatus(transaction.txid!, 'confirmed');
        
        // Get updated transaction
        const updatedTx = await this.dbService.getTransaction(result.txid);
        
        return {
          success: true,
          txid: result.txid,
          transaction: updatedTx || undefined,
        };
      } else {
        // Mark as failed
        await this.dbService.updateTransactionStatus(transaction.txid!, 'failed');
        
        return {
          success: false,
          error: result.error || 'Payment failed',
          transaction: transaction,
        };
      }
    } catch (error: any) {
      const appError = this.errorHandler.parseError(error, 'SendPayment');
      return {
        success: false,
        error: appError.userMessage,
      };
    }
  }

  /**
   * Execute payment with retry logic
   */
  private async executePaymentWithRetry(
    request: PaymentRequest,
    txid: string,
    config: RetryConfig
  ): Promise<PaymentResult> {
    let lastError: any = null;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        console.log(`Payment attempt ${attempt}/${config.maxAttempts} for ${txid}`);
        
        // Execute the actual payment
        const result = await this.executePayment(request);
        
        // Success!
        return {
          success: true,
          txid: result.txid,
        };
      } catch (error: any) {
        lastError = error;
        const appError = this.errorHandler.parseError(error, 'Payment Execution');
        
        console.warn(`Payment attempt ${attempt} failed:`, appError.message);
        
        // Don't retry if error is not retryable
        if (!appError.retryable) {
          console.log('Error is not retryable, aborting');
          break;
        }
        
        // Don't retry on last attempt
        if (attempt === config.maxAttempts) {
          console.log('Max retry attempts reached');
          break;
        }
        
        // Wait before retrying (exponential backoff)
        const delay = config.delayMs * Math.pow(config.backoffMultiplier, attempt - 1);
        console.log(`Waiting ${delay}ms before retry...`);
        await this.delay(delay);
      }
    }
    
    // All attempts failed
    const appError = this.errorHandler.parseError(lastError, 'Payment Failed');
    return {
      success: false,
      error: appError.userMessage,
    };
  }

  /**
   * Execute the actual payment (Lightning or RGB)
   */
  private async executePayment(request: PaymentRequest): Promise<{ txid: string }> {
    if (request.invoice) {
      // Lightning invoice payment
      const response = await this.rgbApiService.sendPayment({
        invoice: request.invoice,
      });
      
      return { txid: response.payment_hash || 'pending' };
    } else if (request.isRGB && request.assetId && request.address) {
      // RGB asset payment
      const response = await this.rgbApiService.sendAsset({
        asset_id: request.assetId,
        assignment: {
          type: 'Fungible',
          value: request.amount,
        },
        recipient_id: request.address,
        donation: false,
        fee_rate: request.feeRate || 1.0,
        min_confirmations: 1,
        transport_endpoints: [],
        skip_sync: false,
      });
      
      return { txid: response.txid };
    } else {
      throw new Error('Invalid payment request: must provide invoice or RGB asset details');
    }
  }

  /**
   * Create pending transaction record
   */
  private async createPendingTransaction(
    walletId: number,
    request: PaymentRequest,
    type: 'send' | 'receive' | 'issue'
  ): Promise<TransactionRecord> {
    const txid = `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const transaction: Omit<TransactionRecord, 'id'> = {
      wallet_id: walletId,
      txid,
      type,
      amount: request.amount,
      asset_id: request.assetId,
      address: request.address || request.invoice || '',
      status: 'pending',
      timestamp: Date.now(),
      fee: 0, // Will be updated after confirmation
    };
    
    const id = await this.dbService.addTransaction(transaction);
    
    return {
      ...transaction,
      id,
    };
  }

  /**
   * Get transaction history for wallet
   */
  async getTransactionHistory(walletId: number, limit: number = 50): Promise<TransactionRecord[]> {
    try {
      return await this.dbService.getTransactionsByWallet(walletId, limit);
    } catch (error) {
      console.error('Failed to get transaction history:', error);
      return [];
    }
  }

  /**
   * Get pending transactions
   */
  async getPendingTransactions(walletId: number): Promise<TransactionRecord[]> {
    try {
      return await this.dbService.getTransactionsByStatus(walletId, 'pending');
    } catch (error) {
      console.error('Failed to get pending transactions:', error);
      return [];
    }
  }

  /**
   * Get transactions by asset
   */
  async getAssetTransactions(walletId: number, assetId: string): Promise<TransactionRecord[]> {
    try {
      return await this.dbService.getTransactionsByAsset(walletId, assetId);
    } catch (error) {
      console.error('Failed to get asset transactions:', error);
      return [];
    }
  }

  /**
   * Get recent transactions (last N days)
   */
  async getRecentTransactions(walletId: number, days: number = 30): Promise<TransactionRecord[]> {
    try {
      return await this.dbService.getRecentTransactions(walletId, days);
    } catch (error) {
      console.error('Failed to get recent transactions:', error);
      return [];
    }
  }

  /**
   * Retry failed transaction
   */
  async retryTransaction(
    transaction: TransactionRecord,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<PaymentResult> {
    if (transaction.status !== 'failed' && transaction.status !== 'pending') {
      return {
        success: false,
        error: 'Only failed or pending transactions can be retried',
      };
    }

    // Reconstruct payment request from transaction
    const request: PaymentRequest = {
      amount: transaction.amount,
      address: transaction.address,
      assetId: transaction.asset_id,
      isRGB: !!transaction.asset_id,
    };

    // Update to pending
    await this.dbService.updateTransactionStatus(transaction.txid, 'pending');

    // Execute with retry
    return await this.executePaymentWithRetry(request, transaction.txid, retryConfig);
  }

  /**
   * Monitor pending transactions and update their status
   */
  async monitorPendingTransactions(walletId: number): Promise<void> {
    try {
      const pending = await this.getPendingTransactions(walletId);
      
      for (const tx of pending) {
        try {
          // Check if transaction is older than 10 minutes
          const age = Date.now() - tx.timestamp;
          const TEN_MINUTES = 10 * 60 * 1000;
          
          if (age > TEN_MINUTES) {
            // Mark very old pending transactions as failed
            console.log(`Marking old pending transaction ${tx.txid} as failed`);
            await this.dbService.updateTransactionStatus(tx.txid, 'failed');
          } else {
            // Try to check status from node (if we have a real txid)
            if (!tx.txid.startsWith('pending_')) {
              // TODO: Query node for transaction status
              // For now, we'll leave it as pending
            }
          }
        } catch (error) {
          console.error(`Failed to monitor transaction ${tx.txid}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to monitor pending transactions:', error);
    }
  }

  /**
   * Record received payment
   */
  async recordReceivedPayment(
    walletId: number,
    txid: string,
    amount: number,
    assetId?: string
  ): Promise<void> {
    try {
      const transaction: Omit<TransactionRecord, 'id'> = {
        wallet_id: walletId,
        txid,
        type: 'receive',
        amount,
        asset_id: assetId,
        address: '', // Received to our wallet
        status: 'confirmed',
        timestamp: Date.now(),
      };
      
      await this.dbService.addTransaction(transaction);
    } catch (error) {
      console.error('Failed to record received payment:', error);
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get transaction statistics
   */
  async getTransactionStats(walletId: number): Promise<{
    total: number;
    pending: number;
    confirmed: number;
    failed: number;
  }> {
    try {
      const all = await this.dbService.getTransactionsByWallet(walletId, 1000);
      
      return {
        total: all.length,
        pending: all.filter(tx => tx.status === 'pending').length,
        confirmed: all.filter(tx => tx.status === 'confirmed').length,
        failed: all.filter(tx => tx.status === 'failed').length,
      };
    } catch (error) {
      console.error('Failed to get transaction stats:', error);
      return {
        total: 0,
        pending: 0,
        confirmed: 0,
        failed: 0,
      };
    }
  }
}

export default TransactionService;



