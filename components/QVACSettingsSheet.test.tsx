jest.mock('../services/voiceDiagnostics', () => ({ voiceDiagnosticReport: () => '{}' }));
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import QVACSettingsSheet from './QVACSettingsSheet';
jest.mock('../services/qvacTts', () => ({ speak: jest.fn(), stopSpeak: jest.fn() }));
const mockDispatch = jest.fn();
let mockVoiceLanguage: string | undefined;
jest.mock('../store/hooks', () => ({ useAppDispatch: () => mockDispatch, useAppSelector: () => ({ voiceLanguage: mockVoiceLanguage }) }));
jest.mock('../store/slices/settingsSlice', () => ({ selectMindConfig: jest.fn(), DEFAULT_MIND_CONFIG: { voiceLanguage: 'it-IT' }, setMindConfig: (payload: any) => ({ type: 'settings/setMindConfig', payload }) }));
const props: any = { visible: true, onClose: jest.fn(), catalog: [], config: {}, llmStatus: 'ready', combinedProgress: 100, onSelectModel: jest.fn(), deviceMemGb: 8, aiMode: 'local', onSetAiMode: jest.fn(), downloadedModelIds: [], onDeleteModel: jest.fn(), sttCatalog: [], ttsOptions: [], onSetSttModel: jest.fn(), onSetTtsEngine: jest.fn() };
beforeEach(() => { mockVoiceLanguage = undefined; mockDispatch.mockClear(); });
it('removes manual language selection and keeps voice output actionable', () => {
  const screen = render(<QVACSettingsSheet {...props} ttsOptions={[{ id: 'supertonic', label: 'Supertonic 3', hint: 'Natural multilingual voice, including Italian.' }]} />);
  fireEvent.press(screen.getByText('Voice'));
  expect(screen.queryByText('Spoken language')).toBeNull();
  expect(screen.getByText('Natural multilingual voice, including Italian.')).toBeTruthy();
  fireEvent.press(screen.getByText('Supertonic 3'));
  expect(props.onSetTtsEngine).toHaveBeenCalledWith('supertonic');
});

it('shows errors from async model changes and hides unsupported desktop models', async () => {
  const onSelectModel = jest.fn().mockRejectedValue(new Error('Loading failed. Try again.'));
  const model = { id: 'phone', label: 'Phone model', tier: 'phone', localCapable: true, sizeMB: 500 };
  const screen = render(<QVACSettingsSheet {...props} onSelectModel={onSelectModel} catalog={[model, { ...model, id: 'mac', label: 'Desktop model', tier: 'mac' }]} />);
  expect(screen.queryByText('Desktop model')).toBeNull();
  fireEvent.press(screen.getByText('Phone model'));
  await waitFor(() => expect(screen.getByText('Loading failed. Try again.')).toBeTruthy());
});
it('prevents model changes while downloading', () => {
  const onSelectModel = jest.fn();
  const screen = render(<QVACSettingsSheet {...props} llmStatus="downloading" onSelectModel={onSelectModel} catalog={[{ id: 'phone', label: 'Phone model', tier: 'phone', localCapable: true, sizeMB: 500 }]} />);
  fireEvent.press(screen.getByText('Phone model'));
  expect(onSelectModel).not.toHaveBeenCalled();
});
it('offers a second voice and hides recognition details initially', async () => {
  const onSetTtsVoice = jest.fn();
  const screen = render(<QVACSettingsSheet {...props} config={{ ttsEngine: 'supertonic' }} onSetTtsVoice={onSetTtsVoice} />);
  fireEvent.press(screen.getByText('Voice'));
  expect(screen.queryByText('Speech-to-text (Whisper)')).toBeNull();
  fireEvent.press(screen.getByText('Masculine · M1'));
  await waitFor(() => expect(onSetTtsVoice).toHaveBeenCalledWith('M1'));
});
it('allows configuring a voice while Agent is off but prevents playback', () => {
  const screen = render(<QVACSettingsSheet {...props} aiMode="off" initialTab="Voice" config={{ ttsEngine: 'supertonic' }} onSetTtsVoice={jest.fn()} />);
  expect(screen.getByText('Masculine · M1')).toBeTruthy();
  fireEvent.press(screen.getByText('Listen to voice'));
  expect(require('../services/qvacTts').speak).not.toHaveBeenCalled();
});
