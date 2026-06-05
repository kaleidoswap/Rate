// services/ToastService.test.ts
import ToastService from './ToastService';

describe('ToastService', () => {
  let toastService: ToastService;
  let mockListener: jest.Mock;

  beforeEach(() => {
    toastService = ToastService.getInstance();
    mockListener = jest.fn();
    jest.clearAllMocks();
  });

  describe('showToast', () => {
    it('should show success toast', () => {
      toastService.addListener(mockListener);
      
      toastService.showSuccess('Success message');

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          message: 'Success message',
          visible: true,
        })
      );
    });

    it('should show error toast', () => {
      toastService.addListener(mockListener);
      
      toastService.showError('Error message');

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: 'Error message',
          visible: true,
        })
      );
    });

    it('should show info toast', () => {
      toastService.addListener(mockListener);
      
      toastService.showInfo('Info message');

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          message: 'Info message',
          visible: true,
        })
      );
    });

    it('should show warning toast', () => {
      toastService.addListener(mockListener);
      
      toastService.showWarning('Warning message');

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: 'Warning message',
          visible: true,
        })
      );
    });

    it('should include action in toast', () => {
      toastService.addListener(mockListener);
      const action = {
        label: 'Retry',
        onPress: jest.fn(),
      };
      
      toastService.showError('Error', action);

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: 'Error',
          action: action,
        })
      );
    });

    it('should use custom duration', () => {
      toastService.addListener(mockListener);
      
      toastService.showSuccess('Success', undefined, 5000);

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: 5000,
        })
      );
    });
  });

  describe('hideToast', () => {
    it('should hide visible toast', () => {
      toastService.addListener(mockListener);
      
      toastService.showSuccess('Success');
      mockListener.mockClear();
      
      toastService.hideToast();

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          visible: false,
        })
      );
    });
  });

  describe('addListener and removeListener', () => {
    it('should notify multiple listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      toastService.addListener(listener1);
      toastService.addListener(listener2);
      
      toastService.showSuccess('Test');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should stop notifying removed listeners', () => {
      const listener = jest.fn();
      const removeListener = toastService.addListener(listener);

      toastService.showSuccess('Test 1');
      expect(listener).toHaveBeenCalledTimes(1);

      removeListener();
      listener.mockClear();

      toastService.showSuccess('Test 2');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle removing non-existent listener', () => {
      const listener = jest.fn();
      const removeListener = toastService.addListener(listener);

      removeListener();
      removeListener(); // Should not throw

      toastService.showSuccess('Test');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('toast queue', () => {
    it('should queue toasts when one is already visible', (done) => {
      toastService.addListener(mockListener);

      toastService.showSuccess('First');
      toastService.showSuccess('Second');

      // First should be shown immediately
      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'First',
          visible: true,
        })
      );

      // Wait for first toast duration + second to show
      setTimeout(() => {
        expect(mockListener).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Second',
            visible: true,
          })
        );
        done();
      }, 3500);
    }, 5000);
  });

  describe('getCurrentToast', () => {
    it('should return current visible toast', () => {
      toastService.showSuccess('Current');

      const current = toastService.getCurrentToast();

      expect(current).toEqual(
        expect.objectContaining({
          message: 'Current',
          visible: true,
        })
      );
    });

    it('should return null when no toast is visible', () => {
      const current = toastService.getCurrentToast();

      expect(current).toBeNull();
    });
  });
});



