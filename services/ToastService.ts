// services/ToastService.ts
import { Alert, Platform } from 'react-native';

export type ToastType = 'success' | 'error' | 'warning' | 'info';
export type ToastPosition = 'top' | 'bottom' | 'center';

export interface ToastConfig {
  type: ToastType;
  message: string;
  duration?: number;
  position?: ToastPosition;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export interface Toast extends ToastConfig {
  id: string;
  timestamp: number;
}

type ToastListener = (toast: Toast) => void;

export class ToastService {
  private static instance: ToastService;
  private listeners: Set<ToastListener> = new Set();
  private toastQueue: Toast[] = [];
  private activeToast: Toast | null = null;

  private constructor() {}

  public static getInstance(): ToastService {
    if (!ToastService.instance) {
      ToastService.instance = new ToastService();
    }
    return ToastService.instance;
  }

  /**
   * Show a success toast
   */
  success(message: string, duration: number = 3000): void {
    this.show({
      type: 'success',
      message,
      duration,
    });
  }

  /**
   * Show an error toast
   */
  error(message: string, duration: number = 4000): void {
    this.show({
      type: 'error',
      message,
      duration,
    });
  }

  /**
   * Show a warning toast
   */
  warning(message: string, duration: number = 3500): void {
    this.show({
      type: 'warning',
      message,
      duration,
    });
  }

  /**
   * Show an info toast
   */
  info(message: string, duration: number = 3000): void {
    this.show({
      type: 'info',
      message,
      duration,
    });
  }

  /**
   * Show a toast with custom configuration
   */
  show(config: ToastConfig): void {
    const toast: Toast = {
      ...config,
      id: this.generateId(),
      timestamp: Date.now(),
      duration: config.duration || 3000,
      position: config.position || 'top',
    };

    // Add to queue
    this.toastQueue.push(toast);

    // Process queue
    this.processQueue();
  }

  /**
   * Show a toast with action button
   */
  showWithAction(
    type: ToastType,
    message: string,
    actionLabel: string,
    onAction: () => void,
    duration: number = 5000
  ): void {
    this.show({
      type,
      message,
      duration,
      action: {
        label: actionLabel,
        onPress: onAction,
      },
    });
  }

  /**
   * Subscribe to toast events
   */
  subscribe(listener: ToastListener): () => void {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(toast: Toast): void {
    this.listeners.forEach(listener => {
      try {
        listener(toast);
      } catch (error) {
        console.error('Toast listener error:', error);
      }
    });
  }

  /**
   * Process toast queue
   */
  private processQueue(): void {
    // If there's already an active toast, wait
    if (this.activeToast) {
      return;
    }

    // Get next toast from queue
    const nextToast = this.toastQueue.shift();
    if (!nextToast) {
      return;
    }

    // Set as active and notify listeners
    this.activeToast = nextToast;
    this.notifyListeners(nextToast);

    // Auto-dismiss after duration
    setTimeout(() => {
      this.dismiss(nextToast.id);
    }, nextToast.duration);
  }

  /**
   * Dismiss a toast
   */
  dismiss(id: string): void {
    if (this.activeToast?.id === id) {
      this.activeToast = null;
      // Process next toast in queue
      setTimeout(() => this.processQueue(), 300);
    } else {
      // Remove from queue if not active
      this.toastQueue = this.toastQueue.filter(t => t.id !== id);
    }
  }

  /**
   * Dismiss all toasts
   */
  dismissAll(): void {
    this.activeToast = null;
    this.toastQueue = [];
  }

  /**
   * Get active toast
   */
  getActiveToast(): Toast | null {
    return this.activeToast;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `toast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Show alert as fallback (for debugging or when toast UI not available)
   */
  showAlert(type: ToastType, message: string): void {
    const title = this.getAlertTitle(type);
    Alert.alert(title, message);
  }

  /**
   * Get alert title based on type
   */
  private getAlertTitle(type: ToastType): string {
    switch (type) {
      case 'success':
        return 'Success';
      case 'error':
        return 'Error';
      case 'warning':
        return 'Warning';
      case 'info':
        return 'Info';
      default:
        return 'Notification';
    }
  }

  /**
   * Helper methods for common use cases
   */

  paymentSuccess(amount: string, recipient?: string): void {
    const message = recipient
      ? `Successfully sent ${amount} to ${recipient}`
      : `Payment of ${amount} sent successfully`;
    this.success(message);
  }

  paymentError(error: string): void {
    this.error(`Payment failed: ${error}`);
  }

  copied(item: string = 'Copied'): void {
    this.success(`${item} copied to clipboard`);
  }

  saved(item: string = 'Changes'): void {
    this.success(`${item} saved successfully`);
  }

  networkError(): void {
    this.error('Network connection error. Please check your internet.');
  }

  nodeConnectionError(): void {
    this.error('Unable to connect to node. Please check your configuration.');
  }

  comingSoon(feature: string = 'This feature'): void {
    this.info(`${feature} is coming soon!`);
  }
}

export default ToastService;



