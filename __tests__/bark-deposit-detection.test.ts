import { renderHook } from '@testing-library/react-native'

// Bark's balance only changes after a sync (no daemon); model that.
let synced = 0
const mockSync = jest.fn(async () => { synced += 1 })
const mockBark = {
  isConnected: () => true,
  getBtcBalance: jest.fn(async () => ({ total: synced >= 2 ? 1500 : 1000 })),
}
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: jest.fn(() => mockBark) } }))
jest.mock('../services/BarkService', () => ({ syncBarkForUpdates: () => mockSync() }))
import { useDepositDetection } from '../hooks/useDepositDetection'

it('syncs Bark before each balance read, so an incoming Ark payment is detected', async () => {
  jest.useFakeTimers()
  const onDetected = jest.fn()
  const methods = [{ key: 'bark', label: 'Bark', protocol: 'BARK', kind: 'address', layer: 'bark', monitor: 'balance', value: 'ark1x', assetId: 'BTC' }] as any
  renderHook(() => useDepositDetection({ enabled: true, methods, onDetected }))
  await jest.advanceTimersByTimeAsync(4_000) // baseline (sync 1)
  await jest.advanceTimersByTimeAsync(8_000) // first poll (sync 2) sees the receive
  expect(mockSync.mock.calls.length).toBeGreaterThanOrEqual(2)
  expect(onDetected).toHaveBeenCalledWith(expect.objectContaining({ layer: 'bark', status: 'confirmed' }))
  jest.useRealTimers()
})
