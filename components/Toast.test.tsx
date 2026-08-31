// components/Toast.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import Toast from './Toast';
import ToastService from '../services/ToastService';

// Mock ToastService
jest.mock('../services/ToastService');

describe('Toast', () => {
  let mockToastService: jest.Mocked<ToastService>;

  beforeEach(() => {
    mockToastService = {
      // Real ToastService.subscribe() always returns an unsubscribe function;
      // Toast.tsx calls it unconditionally on cleanup, so the mock needs the
      // same default rather than undefined.
      subscribe: jest.fn(() => jest.fn()),
      getInstance: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      dismiss: jest.fn(),
    } as any;

    (ToastService.getInstance as jest.Mock).mockReturnValue(mockToastService);
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should not render when no toast is visible', () => {
      mockToastService.subscribe.mockImplementation((callback) => {
        // Don't trigger any toast
        return jest.fn();
      });

      const { queryByTestId } = render(<Toast />);

      expect(queryByTestId('toast-container')).toBeNull();
    });

    it('should render success toast', () => {
      mockToastService.subscribe.mockImplementation((callback) => {
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
      mockToastService.subscribe.mockImplementation((callback) => {
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
      mockToastService.subscribe.mockImplementation((callback) => {
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
      mockToastService.subscribe.mockImplementation((callback) => {
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

      mockToastService.subscribe.mockImplementation((callback) => {
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

      mockToastService.subscribe.mockImplementation((callback) => {
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
      mockToastService.subscribe.mockImplementation((callback) => {
        callback({
          id: 'toast-1',
          type: 'success',
          message: 'Success',
          duration: 3000,
        });
        return jest.fn();
      });

      const { getByTestId } = render(<Toast />);

      fireEvent.press(getByTestId('toast-close-button'));

      // Dismissal is service-owned: the component just forwards the id to
      // ToastService.dismiss() — auto-dismiss timing lives inside the real
      // ToastService's processQueue() (a setTimeout), not in this component,
      // so it isn't observable through a mocked service and isn't tested here.
      expect(mockToastService.dismiss).toHaveBeenCalledWith('toast-1');
    });
  });

  describe('Lifecycle', () => {
    it('should subscribe to ToastService on mount', () => {
      render(<Toast />);

      expect(mockToastService.subscribe).toHaveBeenCalled();
    });

    it('should unsubscribe from ToastService on unmount', () => {
      const unsubscribe = jest.fn();
      mockToastService.subscribe.mockReturnValue(unsubscribe);

      const { unmount } = render(<Toast />);

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('Multiple Toasts', () => {
    it('should update when new toast is shown', () => {
      let callback: any;

      mockToastService.subscribe.mockImplementation((cb) => {
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



