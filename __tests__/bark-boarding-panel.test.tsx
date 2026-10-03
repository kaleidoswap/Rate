// Ported from the removed Bark screen: boarding now lives in Receive
// (Bark → "Deposit from Bitcoin"), and must still be reviewed before funds move.
import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'

const mockBoard = jest.fn(async () => ({}))
const mockReadOnchain = jest.fn(async () => ({ confirmedSats: 20000, pendingSats: 500 }))
jest.mock('../services/BarkService', () => ({
  barkNetworkLabel: () => 'Mainnet',
  readBarkOnchain: () => mockReadOnchain(),
  getBarkBoardingTerms: async () => ({ minBoardAmountSats: 10000, requiredConfirmations: 3 }),
  boardBarkFunds: (...args: any[]) => mockBoard(...args),
}))
import { BarkBoardingPanel } from '../components/receive/BarkBoardingPanel'

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
})

it('shows the on-chain funding available to board', async () => {
  const ui = render(<BarkBoardingPanel />)
  await waitFor(() => expect(ui.getByText(/20,000 sats confirmed · 500 pending/)).toBeTruthy())
})

it('requires an explicit confirmation before boarding', async () => {
  const ui = render(<BarkBoardingPanel />)
  fireEvent.changeText(ui.getByLabelText('Boarding amount in sats'), '10000')
  fireEvent.press(ui.getByText('Review boarding'))
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled())
  expect(mockBoard).not.toHaveBeenCalled()
  const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0]
  expect(title).toBe('Move on-chain funds into Bark?')
  expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Board funds'])
  buttons[1].onPress()
  await waitFor(() => expect(mockBoard).toHaveBeenCalledWith(10000))
})

it('refuses amounts below the server minimum', async () => {
  const ui = render(<BarkBoardingPanel />)
  fireEvent.changeText(ui.getByLabelText('Boarding amount in sats'), '5000')
  fireEvent.press(ui.getByText('Review boarding'))
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Board funds', 'Minimum boarding amount: 10000 sats.'))
  expect(mockBoard).not.toHaveBeenCalled()
})

it('a failed balance read stops the spinner and can be refreshed', async () => {
  mockReadOnchain.mockRejectedValueOnce(new Error('esplora down'))
  const ui = render(<BarkBoardingPanel />)
  await waitFor(() => expect(ui.getByText('Could not read the on-chain balance.')).toBeTruthy())
  fireEvent.press(ui.getByLabelText('Refresh on-chain balance'))
  await waitFor(() => expect(ui.getByText(/20,000 sats confirmed/)).toBeTruthy())
  ui.unmount()
})
