// services/NetworkService.test.ts
import NetworkService from './NetworkService';
import NetInfo from '@react-native-community/netinfo';

// Mock NetInfo
jest.mock('@react-native-community/netinfo');
const mockedNetInfo = NetInfo as jest.Mocked<typeof NetInfo>;

describe('NetworkService', () => {
  let networkService: NetworkService;

  beforeEach(() => {
    networkService = NetworkService.getInstance();
    jest.clearAllMocks();
  });

  describe('isConnected', () => {
    it('should return true when connected', () => {
      // Set up the service with connected status
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      const isConnected = networkService.isConnected();

      expect(isConnected).toBe(true);
    });

    it('should return false when not connected', () => {
      networkService['currentStatus'] = {
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      };

      const isConnected = networkService.isConnected();

      expect(isConnected).toBe(false);
    });

    it('should return false when status is null', () => {
      networkService['currentStatus'] = null;

      const isConnected = networkService.isConnected();

      expect(isConnected).toBe(false);
    });
  });

  describe('isInternetReachable', () => {
    it('should return true when internet is reachable', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      const reachable = networkService.isInternetReachable();

      expect(reachable).toBe(true);
    });

    it('should return false when internet is not reachable', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: false,
        type: 'wifi',
        details: null,
      };

      const reachable = networkService.isInternetReachable();

      expect(reachable).toBe(false);
    });

    it('should return false when status is null', () => {
      networkService['currentStatus'] = null;

      const reachable = networkService.isInternetReachable();

      expect(reachable).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return current network status', () => {
      const mockStatus = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi' as const,
        details: {},
      };

      networkService['currentStatus'] = mockStatus;

      const status = networkService.getStatus();

      expect(status).toEqual(mockStatus);
    });

    it('should return null when no status available', () => {
      networkService['currentStatus'] = null;

      const status = networkService.getStatus();

      expect(status).toBeNull();
    });
  });

  describe('getConnectionType', () => {
    it('should return connection type', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      const type = networkService.getConnectionType();

      expect(type).toBe('wifi');
    });

    it('should return null when no status', () => {
      networkService['currentStatus'] = null;

      const type = networkService.getConnectionType();

      expect(type).toBeNull();
    });

    it('should handle cellular connection', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: { cellularGeneration: '4g' },
      };

      const type = networkService.getConnectionType();

      expect(type).toBe('cellular');
    });
  });

  describe('isWiFi', () => {
    it('should return true when on WiFi', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      expect(networkService.isWiFi()).toBe(true);
    });

    it('should return false when not on WiFi', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: null,
      };

      expect(networkService.isWiFi()).toBe(false);
    });
  });

  describe('isCellular', () => {
    it('should return true when on cellular', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: null,
      };

      expect(networkService.isCellular()).toBe(true);
    });

    it('should return false when not on cellular', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      expect(networkService.isCellular()).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('should call listener with current status immediately', () => {
      const listener = jest.fn();
      const mockStatus = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi' as const,
        details: null,
      };

      networkService['currentStatus'] = mockStatus;

      networkService.subscribe(listener);

      expect(listener).toHaveBeenCalledWith(mockStatus);
    });

    it('should not call listener if no current status', () => {
      const listener = jest.fn();
      networkService['currentStatus'] = null;

      networkService.subscribe(listener);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const listener = jest.fn();
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      const unsubscribe = networkService.subscribe(listener);

      expect(typeof unsubscribe).toBe('function');

      // Call unsubscribe
      unsubscribe();

      // Verify listener was removed
      expect(networkService['listeners'].has(listener)).toBe(false);
    });
  });

  describe('waitForConnection', () => {
    it('should resolve immediately if already online', async () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      const startTime = Date.now();
      const connected = await networkService.waitForConnection(5000);
      const elapsed = Date.now() - startTime;

      expect(connected).toBe(true);
      expect(elapsed).toBeLessThan(1000);
    });

    it('should timeout if connection not established', async () => {
      networkService['currentStatus'] = {
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      };

      const connected = await networkService.waitForConnection(100);

      expect(connected).toBe(false);
    });
  });

  describe('getConnectionQuality', () => {
    it('should return offline when not connected', () => {
      networkService['currentStatus'] = {
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      };

      const quality = networkService.getConnectionQuality();

      expect(quality).toBe('offline');
    });

    it('should return poor when connected but no internet', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: false,
        type: 'wifi',
        details: null,
      };

      const quality = networkService.getConnectionQuality();

      expect(quality).toBe('poor');
    });

    it('should return excellent for WiFi', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      const quality = networkService.getConnectionQuality();

      expect(quality).toBe('excellent');
    });

    it('should return good for cellular', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: null,
      };

      const quality = networkService.getConnectionQuality();

      expect(quality).toBe('good');
    });
  });

  describe('getStats', () => {
    it('should return network statistics', () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      const stats = networkService.getStats();

      expect(stats).toEqual({
        isConnected: true,
        type: 'wifi',
        quality: 'excellent',
        hasInternet: true,
      });
    });

    it('should handle offline state', () => {
      networkService['currentStatus'] = {
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      };

      const stats = networkService.getStats();

      expect(stats).toEqual({
        isConnected: false,
        type: 'none',
        quality: 'offline',
        hasInternet: false,
      });
    });
  });

  describe('refresh', () => {
    it('should fetch and update network status', async () => {
      const mockState = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi' as const,
        details: {},
      };

      mockedNetInfo.fetch.mockResolvedValue(mockState as any);

      const status = await networkService.refresh();

      expect(status.isConnected).toBe(true);
      expect(status.type).toBe('wifi');
      expect(mockedNetInfo.fetch).toHaveBeenCalled();
    });
  });

  describe('executeWhenOnline', () => {
    it('should execute function when online', async () => {
      networkService['currentStatus'] = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      };

      const mockFn = jest.fn().mockResolvedValue('result');

      const result = await networkService.executeWhenOnline(mockFn);

      expect(result).toBe('result');
      expect(mockFn).toHaveBeenCalled();
    });

    it('should throw error when offline and timeout', async () => {
      networkService['currentStatus'] = {
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      };

      const mockFn = jest.fn().mockResolvedValue('result');

      await expect(
        networkService.executeWhenOnline(mockFn, 100)
      ).rejects.toThrow('No network connection available');

      expect(mockFn).not.toHaveBeenCalled();
    });
  });
});
