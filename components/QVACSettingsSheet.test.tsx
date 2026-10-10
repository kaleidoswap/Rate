import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import QVACSettingsSheet from './QVACSettingsSheet';
const mockDispatch = jest.fn();
let mockVoiceLanguage: string | undefined;
jest.mock('../store/hooks', () => ({ useAppDispatch: () => mockDispatch, useAppSelector: () => ({ voiceLanguage: mockVoiceLanguage }) }));
jest.mock('../store/slices/settingsSlice', () => ({ selectMindConfig: jest.fn(), DEFAULT_MIND_CONFIG: { voiceLanguage: 'it-IT' }, setMindConfig: (payload: any) => ({ type: 'settings/setMindConfig', payload }) }));
const props: any = { visible: true, onClose: jest.fn(), catalog: [], config: {}, llmStatus: 'ready', combinedProgress: 100, onSelectModel: jest.fn(), deviceMemGb: 8, aiMode: 'local', onSetAiMode: jest.fn(), downloadedModelIds: [], onDeleteModel: jest.fn(), sttCatalog: [], ttsOptions: [], onSetSttModel: jest.fn(), onSetTtsEngine: jest.fn() };
beforeEach(() => { mockVoiceLanguage = undefined; mockDispatch.mockClear(); });
it('defaults old profiles to Italian and saves the chosen voice language independently', () => {
  const screen = render(<QVACSettingsSheet {...props} />);
  expect(screen.getByLabelText('Italiano').props.accessibilityState.checked).toBe(true);
  fireEvent.press(screen.getByLabelText('English'));
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'settings/setMindConfig', payload: { voiceLanguage: 'en-US' } });
});
it('reflects the saved choice and explains the non-English system fallback', () => {
  mockVoiceLanguage = 'fr-FR'; const screen = render(<QVACSettingsSheet {...props} />);
  expect(screen.getByLabelText('Français').props.accessibilityState.checked).toBe(true);
  expect(screen.getByText('Uses an installed system voice for this language. No cloud speech service.')).toBeTruthy();
});
