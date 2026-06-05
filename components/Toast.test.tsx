// components/Toast.test.tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import Toast from './Toast';
import ToastService from '../services/ToastService';

// Mock ToastService
jest.mock('../services/ToastService');

describe('Toast', () => {
  let mockToastService: jest.Mocked<ToastService>;

  beforeEach(() => {
    mockToastService = {
      addListener: jest.fn(),
      getInstance: jest.fn(),
      showSuccess: jest.fn(),
      showError: jest.fn(),
      showInfo: jest.fn(),
      showWarning: jest.fn(),
      hideToast: jest.fn(),
    } as any;

    (ToastService.getInstance as jest.Mock).mockReturnValue(mockToastService);
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should not render when no toast is visible', () => {
      mockToastService.addListener.mockImplementation((callback) => {
        // Don't trigger any toast
        return jest.fn();
      });

      const { queryByTestId } = render(<Toast />);

      expect(queryByTestId('toast-container')).toBeNull();
    });

    it('should render success toast', () => {
      mockToastService.addListener.mockImplementation((callback) => {
        callback({
          type: 'success',
          message: 'Success message',
          visible: true,
          duration: 3000,
        });
        return jest.fn();
      });

      const { getByText } = render(<Toast />);

      expect(getByText('Success message')).toBeTruthy();
    });

    it('should render error toast', () => {
      mockToastService.addListener.mockImplementation((callback) => {
        callback({
          type: 'error',
          message: 'Error message',
          visible: true,
          duration: 3000,
        });
        return jest.fn();
      });

      const { getByText } = render(<Toast />);

      expect(getByText('Error message')).toBeTruthy();
    });

    it('should render info toast', () => {
      mockToastService.addListener.mockImplementation((callback) => {
        callback({
          type: 'info',
          message: 'Info message',
          visible: true,
          duration: 3000,
        });
        return jest.fn();
      });

      const { getByText } = render(<Toast />);

      expect(getByText('Info message')).toBeTruthy();
    });

    it('should render warning toast', () => {
      mockToastService.addListener.mockImplementation((callback) => {
        callback({
          type: 'warning',
          message: 'Warning message',
          visible: true,
          duration: 3000,
        });
        return jest.fn();
      });

      const { getByText } = render(<Toast />);

      expect(getByText('Warning message')).toBeTruthy();
    });

    it('should render action button when provided', () => {
      const mockAction = {
        label: 'Retry',
        onPress: jest.fn(),
      };

      mockToastService.addListener.mockImplementation((callback) => {
        callback({
          type: 'error',
          message: 'Error with action',
          visible: true,
          duration: 3000,
          action: mockAction,
        });
        return jest.fn();
      });

      const { getByText } = render(<Toast />);

      expect(getByText('Retry')).toBeTruthy();
    });
  });

  describe('Interaction', () => {
    it('should call action onPress when action button is pressed', () => {
      const mockAction = {
        label: 'Retry',
        onPress: jest.fn(),
      };

      mockToastService.addListener.mockImplementation((callback) => {
        callback({
          type: 'error',
          message: 'Error',
          visible: true,
          duration: 3000,
          action: mockAction,
        });
        return jest.fn();
      });

      const { getByText } = render(<Toast />);

      fireEvent.press(getByText('Retry'));

      expect(mockAction.onPress).toHaveBeenCalledTimes(1);
    });

    it('should dismiss toast when close button is pressed', () => {
      mockToastService.addListener.mockImplementation((callback) => {
        callback({
          type: 'success',
          message: 'Success',
          visible: true,
          duration: 3000,
        });
        return jest.fn();
      });

      const { getByTestId } = render(<Toast />);

      fireEvent.press(getByTestId('toast-close-button'));

      expect(mockToastService.hideToast).toHaveBeenCalled();
    });
  });

  describe('Auto-dismiss', () => {
    it('should auto-dismiss after duration', async () => {
      jest.useFakeTimers();

      mockToastService.addListener.mockImplementation((callback) => {
        callback({
          type: 'success',
          message: 'Auto-dismiss',
          visible: true,
          duration: 2000,
        });
        return jest.fn();
      });

      render(<Toast />);

      jest.advanceTimersByTime(2000);

      await waitFor(() => {
        expect(mockToastService.hideToast).toHaveBeenCalled();
      });

      jest.useRealTimers();
    });

    it('should not auto-dismiss if duration is 0', async () => {
      jest.useFakeTimers();

      mockToastService.addListener.mockImplementation((callback) => {
        callback({
          type: 'success',
          message: 'No auto-dismiss',
          visible: true,
          duration: 0,
        });
        return jest.fn();
      });

      render(<Toast />);

      jest.advanceTimersByTime(5000);

      await waitFor(() => {
        expect(mockToastService.hideToast).not.toHaveBeenCalled();
      });

      jest.useRealTimers();
    });
  });

  describe('Lifecycle', () => {
    it('should subscribe to ToastService on mount', () => {
      render(<Toast />);

      expect(mockToastService.addListener).toHaveBeenCalled();
    });

    it('should unsubscribe from ToastService on unmount', () => {
      const unsubscribe = jest.fn();
      mockToastService.addListener.mockReturnValue(unsubscribe);

      const { unmount } = render(<Toast />);

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('Multiple Toasts', () => {
    it('should update when new toast is shown', () => {
      let callback: any;

      mockToastService.addListener.mockImplementation((cb) => {
        callback = cb;
        return jest.fn();
      });

      const { getByText, rerender } = render(<Toast />);

      // Show first toast
      callback({
        type: 'success',
        message: 'First toast',
        visible: true,
        duration: 3000,
      });

      rerender(<Toast />);
      expect(getByText('First toast')).toBeTruthy();

      // Show second toast
      callback({
        type: 'error',
        message: 'Second toast',
        visible: true,
        duration: 3000,
      });

      rerender(<Toast />);
      expect(getByText('Second toast')).toBeTruthy();
    });
  });
});



