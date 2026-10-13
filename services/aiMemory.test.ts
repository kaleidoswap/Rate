import AsyncStorage from '@react-native-async-storage/async-storage';
import { asyncStorageMemoryIO } from './aiMemory';
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));
it('reports a failed deletion instead of pretending saved memory was erased', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(asyncStorageMemoryIO().save([])).rejects.toThrow('Storage unavailable');
});
