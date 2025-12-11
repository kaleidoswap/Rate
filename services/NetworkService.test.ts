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

  describe('isOnline', () => {
    it('should return true when connected', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      } as any);

      const isOnline = await networkService.isOnline();

      expect(isOnline).toBe(true);
      expect(mockedNetInfo.fetch).toHaveBeenCalled();
    });

    it('should return false when not connected', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      } as any);

      const isOnline = await networkService.isOnline();

      expect(isOnline).toBe(false);
    });

    it('should return false when connected but internet not reachable', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: false,
        type: 'wifi',
        details: null,
      } as any);

      const isOnline = await networkService.isOnline();

      expect(isOnline).toBe(false);
    });

    it('should handle null connectivity state', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: null,
        isInternetReachable: null,
        type: 'unknown',
        details: null,
      } as any);

      const isOnline = await networkService.isOnline();

      expect(isOnline).toBe(false);
    });
  });

  describe('getNetworkState', () => {
    it('should return complete network state', async () => {
      const mockState = {
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi' as const,
        details: {
          isConnectionExpensive: false,
        },
      };

      mockedNetInfo.fetch.mockResolvedValue(mockState as any);

      const state = await networkService.getNetworkState();

      expect(state).toEqual(mockState);
    });

    it('should handle cellular connection', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: {
          isConnectionExpensive: true,
          cellularGeneration: '4g',
        },
      } as any);

      const state = await networkService.getNetworkState();

      expect(state.type).toBe('cellular');
      expect(state.details?.isConnectionExpensive).toBe(true);
    });
  });

  describe('addConnectionListener', () => {
    it('should call listener when network state changes', () => {
      const listener = jest.fn();
      const unsubscribe = jest.fn();

      mockedNetInfo.addEventListener.mockReturnValue(unsubscribe);

      const removeListener = networkService.addConnectionListener(listener);

      expect(mockedNetInfo.addEventListener).toHaveBeenCalled();
      expect(removeListener).toBe(unsubscribe);
    });

    it('should handle multiple listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      mockedNetInfo.addEventListener.mockReturnValue(jest.fn());

      networkService.addConnectionListener(listener1);
      networkService.addConnectionListener(listener2);

      expect(mockedNetInfo.addEventListener).toHaveBeenCalledTimes(2);
    });
  });

  describe('waitForConnection', () => {
    it('should resolve immediately if already online', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      } as any);

      const startTime = Date.now();
      await networkService.waitForConnection(5000);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(1000);
    });

    it('should wait for connection', async () => {
      let callCount = 0;
      mockedNetInfo.fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          isConnected: callCount > 2,
          isInternetReachable: callCount > 2,
          type: callCount > 2 ? 'wifi' : 'none',
          details: null,
        } as any);
      });

      const connected = await networkService.waitForConnection(3000);

      expect(connected).toBe(true);
    });

    it('should timeout if connection not established', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      } as any);

      const connected = await networkService.waitForConnection(1000);

      expect(connected).toBe(false);
    });
  });

  describe('getConnectionType', () => {
    it('should return connection type', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      } as any);

      const type = await networkService.getConnectionType();

      expect(type).toBe('wifi');
    });

    it('should return none when disconnected', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      } as any);

      const type = await networkService.getConnectionType();

      expect(type).toBe('none');
    });
  });

  describe('isConnectionExpensive', () => {
    it('should return true for expensive connections', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: {
          isConnectionExpensive: true,
        },
      } as any);

      const isExpensive = await networkService.isConnectionExpensive();

      expect(isExpensive).toBe(true);
    });

    it('should return false for wifi', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: {
          isConnectionExpensive: false,
        },
      } as any);

      const isExpensive = await networkService.isConnectionExpensive();

      expect(isExpensive).toBe(false);
    });

    it('should return false when no details available', async () => {
      mockedNetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      } as any);

      const isExpensive = await networkService.isConnectionExpensive();

      expect(isExpensive).toBe(false);
    });
  });
});

