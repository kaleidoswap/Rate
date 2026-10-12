import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import QVACSettingsSheet from './QVACSettingsSheet';
const mockDispatch = jest.fn();
let mockVoiceLanguage: string | undefined;
jest.mock('../store/hooks', () => ({ useAppDispatch: () => mockDispatch, useAppSelector: () => ({ voiceLanguage: mockVoiceLanguage }) }));
jest.mock('../store/slices/settingsSlice', () => ({ selectMindConfig: jest.fn(), DEFAULT_MIND_CONFIG: { voiceLanguage: 'it-IT' }, setMindConfig: (payload: any) => ({ type: 'settings/setMindConfig', payload }) }));
const props: any = { visible: true, onClose: jest.fn(), catalog: [], config: {}, llmStatus: 'ready', combinedProgress: 100, onSelectModel: jest.fn(), deviceMemGb: 8, aiMode: 'local', onSetAiMode: jest.fn(), downloadedModelIds: [], onDeleteModel: jest.fn(), sttCatalog: [], ttsOptions: [], onSetSttModel: jest.fn(), onSetTtsEngine: jest.fn() };
beforeEach(() => { mockVoiceLanguage = undefined; mockDispatch.mockClear(); });
it('removes manual language selection and keeps voice output actionable', () => {
  const screen = render(<QVACSettingsSheet {...props} ttsOptions={[{ id: 'supertonic', label: 'Supertonic 3', hint: 'Natural multilingual voice, including Italian.' }]} />);
  expect(screen.queryByText('Spoken language')).toBeNull();
  expect(screen.getByText('Natural multilingual voice, including Italian.')).toBeTruthy();
  fireEvent.press(screen.getByText('Supertonic 3'));
  expect(props.onSetTtsEngine).toHaveBeenCalledWith('supertonic');
});
