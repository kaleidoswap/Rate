// services/NetworkService.ts
import NetInfo, { NetInfoState, NetInfoStateType } from '@react-native-community/netinfo';
import ToastService from './ToastService';

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: NetInfoStateType;
  details: any;
}

type NetworkListener = (status: NetworkStatus) => void;

export class NetworkService {
  private static instance: NetworkService;
  private listeners: Set<NetworkListener> = new Set();
  private currentStatus: NetworkStatus | null = null;
  private unsubscribe: (() => void) | null = null;
  private toastService: ToastService;
  private wasOffline: boolean = false;

  private constructor() {
    this.toastService = ToastService.getInstance();
  }

  public static getInstance(): NetworkService {
    if (!NetworkService.instance) {
      NetworkService.instance = new NetworkService();
    }
    return NetworkService.instance;
  }

  /**
   * Initialize network monitoring
   */
  async initialize(): Promise<void> {
    // Get initial state
    const state = await NetInfo.fetch();
    this.updateStatus(state);

    // Subscribe to network state changes
    this.unsubscribe = NetInfo.addEventListener((state) => {
      this.updateStatus(state);
    });

    console.log('Network monitoring initialized');
  }

  /**
   * Update network status and notify listeners
   */
  private updateStatus(state: NetInfoState): void {
    const newStatus: NetworkStatus = {
      isConnected: state.isConnected ?? false,
      isInternetReachable: state.isInternetReachable,
      type: state.type,
      details: state.details,
    };

    const statusChanged = 
      !this.currentStatus ||
      this.currentStatus.isConnected !== newStatus.isConnected ||
      this.currentStatus.isInternetReachable !== newStatus.isInternetReachable;

    this.currentStatus = newStatus;

    if (statusChanged) {
      this.handleStatusChange(newStatus);
      this.notifyListeners(newStatus);
    }
  }

  /**
   * Handle network status changes
   */
  private handleStatusChange(status: NetworkStatus): void {
    if (!status.isConnected) {
      // Device went offline
      this.wasOffline = true;
      this.toastService.warning('You are offline. Some features may not be available.', 5000);
      console.log('Network: Offline');
    } else if (this.wasOffline) {
      // Device came back online
      this.wasOffline = false;
      this.toastService.success('You are back online!');
      console.log('Network: Online');
    }

    // Check internet reachability
    if (status.isConnected && status.isInternetReachable === false) {
      this.toastService.warning('Connected but no internet access', 4000);
      console.log('Network: Connected but no internet');
    }
  }

  /**
   * Subscribe to network status changes
   */
  subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);

    // Send current status immediately
    if (this.currentStatus) {
      listener(this.currentStatus);
    }

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(status: NetworkStatus): void {
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('Network listener error:', error);
      }
    });
  }

  /**
   * Get current network status
   */
  getStatus(): NetworkStatus | null {
    return this.currentStatus;
  }

  /**
   * Check if device is connected
   */
  isConnected(): boolean {
    return this.currentStatus?.isConnected ?? false;
  }

  /**
   * Check if internet is reachable
   */
  isInternetReachable(): boolean {
    return this.currentStatus?.isInternetReachable === true;
  }

  /**
   * Refresh network status
   */
  async refresh(): Promise<NetworkStatus> {
    const state = await NetInfo.fetch();
    this.updateStatus(state);
    return this.currentStatus!;
  }

  /**
   * Get connection type
   */
  getConnectionType(): NetInfoStateType | null {
    return this.currentStatus?.type ?? null;
  }

  /**
   * Check if on WiFi
   */
  isWiFi(): boolean {
    return this.currentStatus?.type === 'wifi';
  }

  /**
   * Check if on cellular
   */
  isCellular(): boolean {
    return this.currentStatus?.type === 'cellular';
  }

  /**
   * Get connection quality description
   */
  getConnectionQuality(): 'excellent' | 'good' | 'poor' | 'offline' {
    if (!this.isConnected()) {
      return 'offline';
    }

    if (this.currentStatus?.isInternetReachable === false) {
      return 'poor';
    }

    if (this.isWiFi()) {
      return 'excellent';
    }

    if (this.isCellular()) {
      // Could check cellular generation if needed
      return 'good';
    }

    return 'good';
  }

  /**
   * Wait for connection
   */
  async waitForConnection(timeoutMs: number = 10000): Promise<boolean> {
    if (this.isConnected()) {
      return true;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);

      const unsubscribe = this.subscribe((status) => {
        if (status.isConnected) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  /**
   * Execute function when online
   */
  async executeWhenOnline<T>(
    fn: () => Promise<T>,
    timeoutMs: number = 10000
  ): Promise<T> {
    const isOnline = await this.waitForConnection(timeoutMs);
    
    if (!isOnline) {
      throw new Error('No network connection available');
    }

    return await fn();
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.listeners.clear();
    console.log('Network monitoring stopped');
  }

  /**
   * Get network statistics
   */
  getStats(): {
    isConnected: boolean;
    type: string;
    quality: string;
    hasInternet: boolean;
  } {
    return {
      isConnected: this.isConnected(),
      type: this.getConnectionType() || 'unknown',
      quality: this.getConnectionQuality(),
      hasInternet: this.isInternetReachable(),
    };
  }
}

export default NetworkService;



