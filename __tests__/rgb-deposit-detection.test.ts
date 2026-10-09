import { renderHook } from '@testing-library/react-native'

// RGB on this phone: the invoice's transfer moves only when refreshed.
let mockStage = 0
const STAGES = ['WaitingCounterparty', 'WaitingConfirmations', 'Settled']
const mockRefresh = jest.fn(async () => { mockStage = Math.min(mockStage + 1, STAGES.length - 1); return true })
const mockRgb = {
  protocolName: 'RGB_L1',
  isConnected: () => true,
  listUnspents: jest.fn(),
  listTransfers: jest.fn(async () => ({ transfers: [{ idx: 1, kind: 'ReceiveWitness', status: STAGES[mockStage], recipient_id: 'rid-1' }] })),
  account: { refreshTransfers: mockRefresh, listTransfers: jest.fn(async () => []) },
  getAssetBalance: jest.fn(async () => ({ total: 0 })),
  getBtcBalance: jest.fn(async () => ({ total: 0 })),
}
jest.mock('../services/protocols', () => ({ protocolManager: { getAdapterIfAvailable: jest.fn(() => mockRgb) } }))
jest.mock('../services/BarkService', () => ({ syncBarkForUpdates: jest.fn() }))
import { useDepositDetection } from '../hooks/useDepositDetection'

const methods = [{ key: 'rgb-onchain', label: 'RGB invoice', protocol: 'RGB', kind: 'invoice', layer: 'rgb', monitor: 'rgb-transfer',
  value: 'rgb:~/~/~/inv', assetId: 'rgb:usdt', recipientId: 'rid-1' }] as any

beforeEach(() => { mockStage = 0; mockRefresh.mockClear(); jest.useFakeTimers() })
afterEach(() => jest.useRealTimers())

it('follows the invoice’s transfer: waiting for the sender, confirming, then received', async () => {
  const onDetected = jest.fn()
  const onStatus = jest.fn()
  renderHook(() => useDepositDetection({ enabled: true, methods, onDetected, onStatus }))
  await jest.advanceTimersByTimeAsync(4_000) // first check refreshes once: now waiting for confirmations
  expect(mockRefresh).toHaveBeenCalledTimes(1)
  expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ layer: 'rgb', status: 'pending', message: expect.stringMatching(/confirms/) }))
  await jest.advanceTimersByTimeAsync(8_000) // 8s after: too soon to refresh again
  expect(mockRefresh).toHaveBeenCalledTimes(1)
  expect(onDetected).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(8_000) // 16s after the first refresh: refresh, settled
  expect(mockRefresh).toHaveBeenCalledTimes(2)
  expect(onDetected).toHaveBeenCalledWith(expect.objectContaining({ layer: 'rgb', status: 'confirmed' }))
  await jest.advanceTimersByTimeAsync(60_000) // detected: polling stopped
  expect(mockRefresh).toHaveBeenCalledTimes(2)
})

it('stops polling when the screen stops watching', async () => {
  mockRefresh.mockImplementation(async () => false)
  const { rerender } = renderHook(({ enabled }) => useDepositDetection({ enabled, methods, onDetected: jest.fn() }), { initialProps: { enabled: true } })
  await jest.advanceTimersByTimeAsync(4_000)
  expect(mockRefresh).toHaveBeenCalledTimes(1)
  rerender({ enabled: false })
  await jest.advanceTimersByTimeAsync(120_000)
  expect(mockRefresh).toHaveBeenCalledTimes(1)
})

it('the unified USD code follows its RGB USDT invoice’s transfer, not the USDT balance', async () => {
  const onDetected = jest.fn()
  const unified = [
    { key: 'rgb', label: 'RGB USDT invoice', protocol: 'RGB', kind: 'invoice', layer: 'rgb', monitor: 'rgb-transfer', value: 'rgb:~/~/~/usdt', assetId: 'rgb:usdt', recipientId: 'rid-1' },
    { key: 'spark', label: 'Spark', protocol: 'SPARK', kind: 'address', layer: 'spark', monitor: 'none', value: 'sp1x', assetId: 'USD' },
  ] as any
  mockRgb.getAssetBalance.mockClear()
  mockStage = 2 // the sender's transfer settles
  renderHook(() => useDepositDetection({ enabled: true, methods: unified, onDetected }))
  await jest.advanceTimersByTimeAsync(4_000)
  expect(mockRgb.listTransfers).toHaveBeenCalledWith({ asset_id: 'rgb:usdt' })
  expect(mockRgb.getAssetBalance).not.toHaveBeenCalled()
  expect(onDetected).toHaveBeenCalledWith(expect.objectContaining({ layer: 'rgb', status: 'confirmed' }))
})
