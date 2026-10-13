import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import MindSettingsScreen from './MindSettingsScreen';
import { setMindConfig } from '../store/slices/settingsSlice';
const mockDispatch = jest.fn();
jest.mock('../store/hooks', () => ({ useAppDispatch: () => mockDispatch, useAppSelector: (fn: any) => fn({ settings: { mindConfig: require('../store/slices/settingsSlice').DEFAULT_MIND_CONFIG, aiMode: 'off', language: 'en' } }) }));
jest.mock('../components', () => ({ ScreenHeader: () => null }));
jest.mock('../components/QVACSettingsSheet', () => () => null);
jest.mock('../hooks/useQVAC', () => ({ useQVAC: () => ({ config: { ttsEngine: 'supertonic' } }) }));
jest.mock('../services/mindAgent', () => ({ clearMindMemory: jest.fn(), listMindMemory: jest.fn(async () => []), removeMindMemory: jest.fn() }));
beforeEach(() => mockDispatch.mockClear());
it('saves personality while editing without requiring blur', () => {
  const screen = render(<MindSettingsScreen />);
  fireEvent.press(screen.getByText('Responses'));
  fireEvent.changeText(screen.getByLabelText('Personal instructions'), 'Keep answers short.');
  expect(mockDispatch).toHaveBeenCalledWith(setMindConfig({ persona: 'Keep answers short.' }));
});
it('shows five focused categories and no inactive or technical controls', () => {
  const screen = render(<MindSettingsScreen />);
  for (const label of ['Voice', 'Responses', 'Memory & privacy', 'Payments & permissions', 'On this device']) expect(screen.getByText(label)).toBeTruthy();
  for (const label of ['Add MCP server', 'Connected tools', 'Creative', 'History kept', 'Knowledge base (RAG)']) expect(screen.queryByText(label)).toBeNull();
});
