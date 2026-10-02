import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
const mockRefresh = jest.fn()
const mockReceive = jest.fn(async () => 'tark1testaddress')
const mockBoard = jest.fn(async () => ({}))
const mockState = {
  enabled: true, connected: true, loading: false, error: null,
  info: { network: 'signet', recovery: 'complete' },
  balance: { spendableSats: 1200, pendingInRoundSats: 25, pendingBoardSats: 50, pendingLightningSendSats: 10, claimableLightningReceiveSats: 0, pendingExitSats: 0 },
  onchain: { confirmedSats: 20000, pendingSats: 0 }, transactions: [], refresh: mockRefresh,
}
jest.mock('../hooks/useBark', () => ({ useBark: () => mockState }))
jest.mock('../services/BarkService', () => ({
  barkNetworkLabel: () => 'Signet · test sats',
  createBarkReceive: (...args: any[]) => mockReceive(...args),
  getBarkBoardingTerms: async () => ({ minBoardAmountSats: 10000, requiredConfirmations: 3 }),
  boardBarkFunds: (...args: any[]) => mockBoard(...args),
}))
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }))
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader' }))
import BarkScreen from '../screens/BarkScreen'

beforeEach(() => jest.clearAllMocks())
it('shows categorized test balances and opens Send with Bark selected', () => {
  const navigation = { navigate: jest.fn() }
  const ui = render(<BarkScreen navigation={navigation} />)
  expect(ui.getByText('1,200 sats')).toBeTruthy()
  expect(ui.getByLabelText('Pending boarding: 50 sats')).toBeTruthy()
  expect(ui.getByText('Bark activity · Signet · test sats')).toBeTruthy()
  fireEvent.press(ui.getByText('Send from Bark'))
  expect(navigation.navigate).toHaveBeenCalledWith('Send', { preferredAccount: 'BARK' })
})
it('generates a request only after an explicit tap, and clears it on method change', async () => {
  const ui = render(<BarkScreen navigation={{ navigate: jest.fn() }} />)
  expect(mockReceive).not.toHaveBeenCalled()
  fireEvent.press(ui.getByText('Generate receive request'))
  await waitFor(() => expect(ui.getByText('tark1testaddress')).toBeTruthy())
  fireEvent.press(ui.getByText('Lightning'))
  expect(ui.queryByText('tark1testaddress')).toBeNull()
  expect(ui.getByLabelText('Lightning amount in sats')).toBeTruthy()
})
it('requires boarding confirmation before moving on-chain funds', async () => {
  const ui = render(<BarkScreen navigation={{ navigate: jest.fn() }} />)
  fireEvent.changeText(ui.getByLabelText('Boarding amount in sats'), '10000')
  fireEvent.press(ui.getByText('Review boarding'))
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled())
  expect(mockBoard).not.toHaveBeenCalled()
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2]
  expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Board funds'])
})
