const mockAdapter = {
  isConnected: jest.fn(() => true),
  backend: { sync: jest.fn(), syncOnchain: jest.fn(), getWalletInfo: jest.fn(), getBalance: jest.fn(), getOnchainBalance: jest.fn(), getOnchainAddress: jest.fn() },
  listTransactions: jest.fn(), getReceiveAddress: jest.fn(), createInvoice: jest.fn(), boardAmount: jest.fn(), boardingTerms: jest.fn(),
}
const mockManager = { getAdapterIfAvailable: jest.fn(() => mockAdapter), getActiveProtocol: jest.fn(() => 'SPARK'), setActiveProtocol: jest.fn(async () => {}), sendPayment: jest.fn() }
jest.mock('../services/protocols', () => ({ protocolManager: {
  getAdapterIfAvailable: (...args: any[]) => mockManager.getAdapterIfAvailable(...args),
  getActiveProtocol: () => mockManager.getActiveProtocol(),
  setActiveProtocol: (...args: any[]) => mockManager.setActiveProtocol(...args),
  sendPayment: (...args: any[]) => mockManager.sendPayment(...args),
} }))
jest.mock('../services/protocols/bark', () => ({ resolveBarkHostConfig: () => ({ network: 'signet' }) }))
import { readBarkAccount, createBarkReceive, sendBarkPayment, boardBarkFunds, barkNetworkLabel } from '../services/BarkService'

beforeEach(() => { jest.clearAllMocks(); mockAdapter.isConnected.mockReturnValue(true) })
it('labels signet as test sats', () => expect(barkNetworkLabel()).toContain('test sats'))
it('reads balances without starting boarding or syncing implicitly', async () => {
  await readBarkAccount()
  expect(mockAdapter.backend.sync).not.toHaveBeenCalled()
  expect(mockAdapter.boardAmount).not.toHaveBeenCalled()
  expect(mockAdapter.backend.getOnchainBalance).toHaveBeenCalled()
})
it('explicitly syncs both wallets on refresh', async () => {
  await readBarkAccount(true)
  expect(mockAdapter.backend.sync).toHaveBeenCalledTimes(1)
  expect(mockAdapter.backend.syncOnchain).toHaveBeenCalledTimes(1)
})
it('rejects disconnected operations', async () => {
  mockAdapter.isConnected.mockReturnValue(false)
  await expect(createBarkReceive('ark')).rejects.toThrow('not connected')
  expect(mockAdapter.getReceiveAddress).not.toHaveBeenCalled()
})
it('uses the separate BDK funding address', async () => {
  mockAdapter.backend.getOnchainAddress.mockResolvedValue('tb1funding')
  expect(await createBarkReceive('onchain')).toBe('tb1funding')
  expect(mockAdapter.boardAmount).not.toHaveBeenCalled()
})
it.each([undefined, 0, -1, 0.5, NaN])('rejects invalid Lightning amount %s', async amount => {
  await expect(createBarkReceive('lightning', amount)).rejects.toThrow('whole number')
  expect(mockAdapter.createInvoice).not.toHaveBeenCalled()
})
it('requests an exact Lightning amount without a custom expiry', async () => {
  mockAdapter.createInvoice.mockResolvedValue({ invoice: 'lntbs1000' })
  expect(await createBarkReceive('lightning', 1000)).toBe('lntbs1000')
  expect(mockAdapter.createInvoice).toHaveBeenCalledWith({ amount: 1000, layer: 'BTC_LN' })
})
it('passes uncertain sends through without retrying and restores the selected account', async () => {
  const error = Object.assign(new Error('uncertain'), { code: 'PAYMENT_OUTCOME_UNKNOWN' })
  mockManager.sendPayment.mockRejectedValueOnce(error)
  await expect(sendBarkPayment({ invoice: 'tark1destination', amount: 1000 })).rejects.toBe(error)
  expect(mockManager.sendPayment).toHaveBeenCalledTimes(1)
  expect(mockManager.setActiveProtocol.mock.calls).toEqual([['BARK'], ['SPARK']])
})
it('boards only after an explicit valid request', async () => {
  await expect(boardBarkFunds(0)).rejects.toThrow('whole number')
  expect(mockAdapter.boardAmount).not.toHaveBeenCalled()
  await boardBarkFunds(10000)
  expect(mockAdapter.boardAmount).toHaveBeenCalledWith(10000)
})
