// services/ErrorHandlingService.test.ts
import ErrorHandlingService, { ErrorType } from './ErrorHandlingService';

describe('ErrorHandlingService', () => {
  let errorHandler: ErrorHandlingService;

  beforeEach(() => {
    errorHandler = ErrorHandlingService.getInstance();
    errorHandler.clearErrorLog();
  });

  describe('parseError', () => {
    it('should classify network errors', () => {
      const error = new Error('Network request failed');
      const appError = errorHandler.parseError(error);

      expect(appError.type).toBe(ErrorType.NETWORK);
      expect(appError.retryable).toBe(true);
      expect(appError.userMessage).toContain('Network connection failed');
    });

    it('should classify node connection errors', () => {
      const error = new Error('Unable to connect to RGB node');
      const appError = errorHandler.parseError(error);

      expect(appError.type).toBe(ErrorType.NODE_CONNECTION);
      expect(appError.retryable).toBe(true);
    });

    it('should classify timeout errors', () => {
      const error = new Error('Request timed out');
      const appError = errorHandler.parseError(error);

      expect(appError.type).toBe(ErrorType.NODE_TIMEOUT);
      expect(appError.retryable).toBe(true);
    });

    it('should classify authentication errors as non-retryable', () => {
      const error = new Error('Unauthorized 401');
      const appError = errorHandler.parseError(error);

      expect(appError.type).toBe(ErrorType.AUTHENTICATION);
      expect(appError.retryable).toBe(false);
    });

    it('should classify validation errors as non-retryable', () => {
      const error = new Error('Invalid input data');
      const appError = errorHandler.parseError(error);

      expect(appError.type).toBe(ErrorType.VALIDATION);
      expect(appError.retryable).toBe(false);
    });

    it('should classify payment errors', () => {
      const error = new Error('Payment failed');
      const appError = errorHandler.parseError(error);

      expect(appError.type).toBe(ErrorType.PAYMENT);
      expect(appError.retryable).toBe(true);
    });

    it('should classify insufficient balance as non-retryable', () => {
      const error = new Error('Insufficient balance');
      const appError = errorHandler.parseError(error);

      expect(appError.type).toBe(ErrorType.INSUFFICIENT_BALANCE);
      expect(appError.retryable).toBe(false);
    });

    it('should handle string errors', () => {
      const error = 'Something went wrong';
      const appError = errorHandler.parseError(error);

      expect(appError.message).toBe(error);
      expect(appError.userMessage).toBe(error);
    });

    it('should add context to error message', () => {
      const error = new Error('Test error');
      const appError = errorHandler.parseError(error, 'Test Context');

      expect(appError.message).toContain('[Test Context]');
    });
  });

  describe('handleErrorWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await errorHandler.handleErrorWithRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Network request failed'))
        .mockRejectedValueOnce(new Error('Network request failed'))
        .mockResolvedValueOnce('success');

      const result = await errorHandler.handleErrorWithRetry(operation, 3, 100);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Unauthorized'));

      await expect(
        errorHandler.handleErrorWithRetry(operation, 3, 100)
      ).rejects.toThrow();

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should fail after max retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Network request failed'));

      await expect(
        errorHandler.handleErrorWithRetry(operation, 3, 100)
      ).rejects.toThrow();

      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Network request failed'))
        .mockRejectedValueOnce(new Error('Network request failed'))
        .mockResolvedValueOnce('success');

      const startTime = Date.now();
      await errorHandler.handleErrorWithRetry(operation, 3, 100);
      const elapsed = Date.now() - startTime;

      // Should have delays: 100ms + 200ms = 300ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(250);
    });
  });

  describe('isRetryable', () => {
    it('should identify retryable errors', () => {
      const error = new Error('Network request failed');
      expect(errorHandler.isRetryable(error)).toBe(true);
    });

    it('should identify non-retryable errors', () => {
      const error = new Error('Unauthorized');
      expect(errorHandler.isRetryable(error)).toBe(false);
    });
  });

  describe('getErrorType', () => {
    it('should return correct error type', () => {
      const error = new Error('Network request failed');
      const type = errorHandler.getErrorType(error);

      expect(type).toBe(ErrorType.NETWORK);
    });
  });

  describe('getErrorLog', () => {
    it('should maintain error history', () => {
      errorHandler.parseError(new Error('Error 1'));
      errorHandler.parseError(new Error('Error 2'));
      errorHandler.parseError(new Error('Error 3'));

      const log = errorHandler.getErrorLog();

      expect(log).toHaveLength(3);
    });

    it('should limit log size', () => {
      // Create more than MAX_LOG_SIZE errors
      for (let i = 0; i < 150; i++) {
        errorHandler.parseError(new Error(`Error ${i}`));
      }

      const log = errorHandler.getErrorLog();

      expect(log.length).toBeLessThanOrEqual(100);
    });

    it('should clear error log', () => {
      errorHandler.parseError(new Error('Error 1'));
      errorHandler.clearErrorLog();

      const log = errorHandler.getErrorLog();

      expect(log).toHaveLength(0);
    });
  });
});



