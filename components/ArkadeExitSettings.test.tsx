beforeAll(() => { (require('react-native') as any).AppState = { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) }; });
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ArkadeExitSettings } from './ArkadeExitSettings';
import { prepareArkadeExitPreview, saveArkadeExitPackage, resumeArkadeExit } from '../services/protocols/arkadeExit';
jest.mock('../localization/useAppLanguage', () => ({ useAppLanguage: () => ({ language: 'en' }) }));
jest.mock('../services/protocols/arkadeContext', () => ({ arkadeContext: () => ({ wallet: {}, network: 'bitcoin' }) }));
jest.mock('../services/protocols/arkadeExit', () => ({
  readArkadeExit: async () => undefined,
  prepareArkadeExitPreview: jest.fn(async () => ({ destination: 'destination', excludedAssets: 0, quote: { fundingAddress: 'fees', shortfallSats: 100, totals: { recoveredSats: 900, totalFeeSats: 100, txCount: 2 } } })),
  saveArkadeExitPackage: jest.fn(async () => ({ started: false, completed: false, package: { sweepAddress: 'destination', totals: { totalFeeSats: 100 }, steps: [] } })),
  resumeArkadeExit: jest.fn(async () => {}), shareArkadeExitPackage: jest.fn(),
}));
test('estimating and preparing do not broadcast; execution requires the distinct confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const ui = render(<ArkadeExitSettings busy={false} onBusyChange={jest.fn()} />); await act(async () => {});
  fireEvent.press(ui.getByText('Emergency Bitcoin exit'));
  fireEvent.changeText(ui.getByLabelText('Destination Bitcoin address'), 'destination');
  await act(async () => { fireEvent.press(ui.getByText('Estimate costs')); });
  expect(prepareArkadeExitPreview).toHaveBeenCalledWith(expect.anything(), 'bitcoin', 'destination');
  await act(async () => { fireEvent.press(ui.getByText('Prepare exit backup')); });
  expect(saveArkadeExitPackage).toHaveBeenCalled(); expect(resumeArkadeExit).not.toHaveBeenCalled();
  fireEvent.press(ui.getByText('Start exit'));
  expect(alert).toHaveBeenCalled(); expect(resumeArkadeExit).not.toHaveBeenCalled();
  alert.mockRestore();
});
