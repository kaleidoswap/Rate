import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import MindSettingsScreen from './MindSettingsScreen';
import { setMindConfig, setAiMode } from '../store/slices/settingsSlice';
const mockDispatch = jest.fn();
let mockAiMode = 'off';
let mockQvac: any;
jest.mock('../store/hooks', () => ({ useAppDispatch: () => mockDispatch, useAppSelector: (fn: any) => fn({ settings: { mindConfig: require('../store/slices/settingsSlice').DEFAULT_MIND_CONFIG, aiMode: mockAiMode, language: 'en' } }) }));
jest.mock('../components', () => ({ ScreenHeader: () => null }));
jest.mock('../components/QVACSettingsSheet', () => () => null);
jest.mock('../hooks/useQVAC', () => ({ useQVAC: () => mockQvac }));
jest.mock('../services/voiceDiagnostics', () => ({ voiceDiagnosticReport: () => '{}' }));
jest.mock('../services/mindAgent', () => ({ clearMindMemory: jest.fn(), listMindMemory: jest.fn(async () => []), removeMindMemory: jest.fn() }));
beforeEach(() => {
  mockDispatch.mockClear(); mockAiMode = 'off';
  mockQvac = { config: { ttsEngine: 'supertonic' } };
});
it('saves personality while editing without requiring blur', () => {
  const screen = render(<MindSettingsScreen />);
  fireEvent.changeText(screen.getByLabelText('Personal instructions'), 'Keep answers short.');
  expect(mockDispatch).toHaveBeenCalledWith(setMindConfig({ persona: 'Keep answers short.' }));
});
it('groups settings into focused sections and hides inactive or technical controls', () => {
  const screen = render(<MindSettingsScreen />);
  for (const label of ['Model', 'Voice', 'Responses', 'Memory & privacy', 'Payments & permissions', 'On this device', 'Advanced']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  for (const label of ['Add MCP server', 'Connected tools', 'Creative', 'History kept', 'Knowledge base (RAG)']) expect(screen.queryByText(label)).toBeNull();
});
it('shows model status in the header and toggles Prismo', () => {
  mockAiMode = 'local';
  mockQvac = { config: { ttsEngine: 'supertonic', modelId: 'qwen' }, catalog: [{ id: 'qwen', label: 'Qwen3.5 0.8B', sizeMB: 600 }], llmStatus: 'downloading', combinedProgress: 42, downloadedModelIds: [] };
  const screen = render(<MindSettingsScreen />);
  expect(screen.getByText('42%')).toBeTruthy();
  expect(screen.getByText('Downloading model… 42%')).toBeTruthy();
  mockQvac = { ...mockQvac, llmStatus: 'ready' };
  screen.rerender(<MindSettingsScreen />);
  expect(screen.getByText('Ready')).toBeTruthy();
  expect(screen.getAllByText('Qwen3.5 0.8B · 600 MB').length).toBeGreaterThan(0);
  fireEvent(screen.getByLabelText('Use Prismo'), 'valueChange', false);
  expect(mockDispatch).toHaveBeenCalledWith(setAiMode('off'));
});
it('groups destructive actions in the danger zone', async () => {
  const deleteModel = jest.fn();
  mockQvac = { config: { modelId: 'a', sttModelId: 's' }, catalog: [{ id: 'a', label: 'A', sizeMB: 600 }, { id: 'b', label: 'B', sizeMB: 1300 }], sttCatalog: [], llmStatus: 'ready', downloadedModelIds: ['a', 'b', 's'], deleteModel };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { (buttons as any)[1].onPress(); });
  const screen = render(<MindSettingsScreen />);
  expect(screen.getByText('Danger zone')).toBeTruthy();
  fireEvent.press(screen.getByText('Delete unused models'));
  await waitFor(() => expect(deleteModel).toHaveBeenCalledWith('b'));
  expect(deleteModel).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});
