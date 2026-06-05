// services/ErrorHandlingService.ts
import { Alert } from 'react-native';

export enum ErrorType {
  NETWORK = 'NETWORK',
  NODE_CONNECTION = 'NODE_CONNECTION',
  NODE_TIMEOUT = 'NODE_TIMEOUT',
  NODE_UNAVAILABLE = 'NODE_UNAVAILABLE',
  AUTHENTICATION = 'AUTHENTICATION',
  VALIDATION = 'VALIDATION',
  PAYMENT = 'PAYMENT',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  CHANNEL = 'CHANNEL',
  ASSET = 'ASSET',
  DATABASE = 'DATABASE',
  SECURITY = 'SECURITY',
  UNKNOWN = 'UNKNOWN',
}

export interface AppError {
  type: ErrorType;
  message: string;
  originalError?: any;
  retryable: boolean;
  userMessage: string;
  technicalDetails?: string;
}

export class ErrorHandlingService {
  private static instance: ErrorHandlingService;
  private errorLog: AppError[] = [];
  private readonly MAX_LOG_SIZE = 100;

  private constructor() {}

  public static getInstance(): ErrorHandlingService {
    if (!ErrorHandlingService.instance) {
      ErrorHandlingService.instance = new ErrorHandlingService();
    }
    return ErrorHandlingService.instance;
  }

  /**
   * Parse and classify an error
   */
  public parseError(error: any, context?: string): AppError {
    let appError: AppError = {
      type: ErrorType.UNKNOWN,
      message: 'An unknown error occurred',
      originalError: error,
      retryable: false,
      userMessage: 'Something went wrong. Please try again.',
    };

    // Handle string errors
    if (typeof error === 'string') {
      appError.message = error;
      appError.userMessage = error;
    }

    // Handle Error objects
    if (error instanceof Error) {
      appError.message = error.message;
      appError.technicalDetails = error.stack;
    }

    // Classify by error message patterns
    const errorMessage = appError.message.toLowerCase();

    // Network errors
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('connection refused') ||
      errorMessage.includes('econnrefused')
    ) {
      appError.type = ErrorType.NETWORK;
      appError.retryable = true;
      appError.userMessage = 'Network connection failed. Please check your internet connection and try again.';
    }

    // Node connection errors
    else if (
      errorMessage.includes('node') ||
      errorMessage.includes('rgb') ||
      errorMessage.includes('unable to connect') ||
      errorMessage.includes('connection error')
    ) {
      appError.type = ErrorType.NODE_CONNECTION;
      appError.retryable = true;
      appError.userMessage = 'Unable to connect to RGB node. Please check your node configuration.';
    }

    // Timeout errors
    else if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('timed out') ||
      errorMessage.includes('etimedout')
    ) {
      appError.type = ErrorType.NODE_TIMEOUT;
      appError.retryable = true;
      appError.userMessage = 'Connection timed out. The node may be slow or unavailable. Please try again.';
    }

    // Node unavailable
    else if (
      errorMessage.includes('unavailable') ||
      errorMessage.includes('not available') ||
      errorMessage.includes('service unavailable') ||
      errorMessage.includes('503')
    ) {
      appError.type = ErrorType.NODE_UNAVAILABLE;
      appError.retryable = true;
      appError.userMessage = 'The RGB node is currently unavailable. Please try again later.';
    }

    // Authentication errors
    else if (
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('401') ||
      errorMessage.includes('403')
    ) {
      appError.type = ErrorType.AUTHENTICATION;
      appError.retryable = false;
      appError.userMessage = 'Authentication failed. Please check your credentials.';
    }

    // Validation errors
    else if (
      errorMessage.includes('invalid') ||
      errorMessage.includes('validation') ||
      errorMessage.includes('malformed') ||
      errorMessage.includes('400')
    ) {
      appError.type = ErrorType.VALIDATION;
      appError.retryable = false;
      appError.userMessage = 'Invalid input. Please check your data and try again.';
    }

    // Payment errors
    else if (
      errorMessage.includes('payment') ||
      errorMessage.includes('invoice') ||
      errorMessage.includes('transaction failed')
    ) {
      appError.type = ErrorType.PAYMENT;
      appError.retryable = true;
      appError.userMessage = 'Payment failed. Please try again or contact support.';
    }

    // Insufficient balance
    else if (
      errorMessage.includes('insufficient') ||
      errorMessage.includes('not enough') ||
      errorMessage.includes('balance too low')
    ) {
      appError.type = ErrorType.INSUFFICIENT_BALANCE;
      appError.retryable = false;
      appError.userMessage = 'Insufficient balance to complete this transaction.';
    }

    // Channel errors
    else if (
      errorMessage.includes('channel') ||
      errorMessage.includes('liquidity')
    ) {
      appError.type = ErrorType.CHANNEL;
      appError.retryable = true;
      appError.userMessage = 'Lightning channel error. Please check your channel status.';
    }

    // Asset errors
    else if (
      errorMessage.includes('asset') ||
      errorMessage.includes('rgb asset')
    ) {
      appError.type = ErrorType.ASSET;
      appError.retryable = true;
      appError.userMessage = 'RGB asset error. Please try again.';
    }

    // Database errors
    else if (
      errorMessage.includes('database') ||
      errorMessage.includes('sqlite') ||
      errorMessage.includes('db')
    ) {
      appError.type = ErrorType.DATABASE;
      appError.retryable = true;
      appError.userMessage = 'Database error. Please restart the app.';
    }

    // Security errors
    else if (
      errorMessage.includes('security') ||
      errorMessage.includes('encryption') ||
      errorMessage.includes('decrypt')
    ) {
      appError.type = ErrorType.SECURITY;
      appError.retryable = false;
      appError.userMessage = 'Security error. Please check your security settings.';
    }

    // Add context if provided
    if (context) {
      appError.message = `[${context}] ${appError.message}`;
    }

    // Log the error
    this.logError(appError);

    return appError;
  }

  /**
   * Handle an error with automatic retry logic
   */
  public async handleErrorWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000,
    context?: string
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const appError = this.parseError(error, context);

        console.log(`Attempt ${attempt}/${maxRetries} failed:`, appError.message);

        // Don't retry if error is not retryable
        if (!appError.retryable) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff
        const delay = delayMs * Math.pow(2, attempt - 1);
        console.log(`Retrying in ${delay}ms...`);
        await this.delay(delay);
      }
    }

    // All retries failed
    throw lastError;
  }

  /**
   * Show user-friendly error alert
   */
  public showErrorAlert(error: any, context?: string, onRetry?: () => void): void {
    const appError = this.parseError(error, context);

    const buttons: any[] = [
      {
        text: 'OK',
        style: 'cancel',
      },
    ];

    if (appError.retryable && onRetry) {
      buttons.unshift({
        text: 'Retry',
        onPress: onRetry,
      });
    }

    Alert.alert(
      this.getErrorTitle(appError.type),
      appError.userMessage,
      buttons
    );
  }

  /**
   * Get user-friendly error title
   */
  private getErrorTitle(type: ErrorType): string {
    switch (type) {
      case ErrorType.NETWORK:
        return 'Network Error';
      case ErrorType.NODE_CONNECTION:
      case ErrorType.NODE_TIMEOUT:
      case ErrorType.NODE_UNAVAILABLE:
        return 'Connection Error';
      case ErrorType.AUTHENTICATION:
        return 'Authentication Error';
      case ErrorType.VALIDATION:
        return 'Validation Error';
      case ErrorType.PAYMENT:
        return 'Payment Error';
      case ErrorType.INSUFFICIENT_BALANCE:
        return 'Insufficient Balance';
      case ErrorType.CHANNEL:
        return 'Channel Error';
      case ErrorType.ASSET:
        return 'Asset Error';
      case ErrorType.DATABASE:
        return 'Database Error';
      case ErrorType.SECURITY:
        return 'Security Error';
      default:
        return 'Error';
    }
  }

  /**
   * Log error for debugging
   */
  private logError(error: AppError): void {
    this.errorLog.push({
      ...error,
      originalError: undefined, // Don't store full error object
    });

    // Keep log size manageable
    if (this.errorLog.length > this.MAX_LOG_SIZE) {
      this.errorLog.shift();
    }

    // Log to console in development
    if (__DEV__) {
      console.error('AppError:', {
        type: error.type,
        message: error.message,
        retryable: error.retryable,
        userMessage: error.userMessage,
        technicalDetails: error.technicalDetails,
      });
    }
  }

  /**
   * Get recent errors for debugging
   */
  public getErrorLog(): AppError[] {
    return [...this.errorLog];
  }

  /**
   * Clear error log
   */
  public clearErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if error is retryable
   */
  public isRetryable(error: any): boolean {
    const appError = this.parseError(error);
    return appError.retryable;
  }

  /**
   * Get error type
   */
  public getErrorType(error: any): ErrorType {
    const appError = this.parseError(error);
    return appError.type;
  }
}

export default ErrorHandlingService;


