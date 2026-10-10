import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import AIAssistantScreen from './AIAssistantScreen';

jest.mock('../components/mind/PrismoAnimatedCharacter', () => ({ PrismoAnimatedCharacter: () => null }));
jest.mock('../services/qvacModels', () => ({ getModelById: () => ({ label: 'Test model' }) }));
jest.mock('expo-blur', () => ({ BlurView: require('react-native').View }));
Object.assign(require('react-native'), { Keyboard: { addListener: () => ({ remove: jest.fn() }), dismiss: jest.fn() } });
let mockEnabled = false;
const mockDispatch = jest.fn();
const mockQVAC = { config: { modelId: 'test' }, service: {}, catalog: [], llmStatus: 'idle',
  combinedProgress: 0, isReady: false, reloadConfig: jest.fn(), downloadedModelIds: [], sttCatalog: [], ttsOptions: [] };
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: (fn: any) => fn({}) }));
jest.mock('../store/slices/settingsSlice', () => ({
  selectAiEnabled: () => mockEnabled, selectAiMode: () => mockEnabled ? 'local' : 'off',
  selectAiOnboarded: () => true, selectMindConfig: () => ({}), setAiMode: jest.fn(), setAiOnboarded: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {}, useIsFocused: () => true }));
jest.mock('../hooks/useQVAC', () => ({ useQVAC: () => mockQVAC }));
jest.mock('../services/QVACService', () => ({ __esModule: true, default: { getInstance: () => ({}) } }));
jest.mock('../services/mindAgent', () => ({ createMindAgent: () => ({ listSkills: () => [] }) }));
jest.mock('../hooks/useAiConfirm', () => ({ useAiConfirm: () => ({ state: null }) }));
jest.mock('../components/mind/KaleidoMindOnboarding', () => ({ KaleidoMindOnboarding: () => null }));
jest.mock('../components/voice-agent/VoiceAgentOverlay', () => {
  const { Text } = require('react-native');
  return { VoiceAgentOverlay: ({ visible }: any) => visible ? <Text>Voice conversation</Text> : null };
});
jest.mock('../components/VoiceInput', () => {
  const React = require('react');
  return React.forwardRef(() => null);
});
jest.mock('../components/PaymentConfirmationModal', () => () => null);
jest.mock('../components/NostrContactsSelector', () => () => null);
jest.mock('../components/InvoiceQRCode', () => ({ shareLightningInvoice: jest.fn() }));
jest.mock('../components/QVACSettingsSheet', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return ({ visible, onClose }: any) => visible ? <TouchableOpacity onPress={onClose}><Text>Model settings</Text></TouchableOpacity> : null;
});
jest.mock('../components', () => {
  const { View } = require('react-native');
  return { MainHeader: ({ rightAction }: any) => <View>{rightAction}</View>, MindCharacter: () => null, MindCharacterBadge: () => null, Badge: () => null };
});
jest.mock('../components/chat', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return { ChatEmptyState: ({ onSuggestion }: any) => <TouchableOpacity onPress={() => onSuggestion('My balance')}><Text>Balance suggestion</Text></TouchableOpacity>,
    MessageBubble: ({ message }: any) => <Text>{message.text}</Text>, TypingDots: () => null, buildCopyText: () => '' };
});
const navigation = { navigate: jest.fn() };
beforeEach(() => { mockEnabled = false; jest.clearAllMocks(); });

it('uses one composer with separate dictation and conversation actions when enabled', () => {
  mockEnabled = true;
  const screen = render(<AIAssistantScreen navigation={navigation} />);
  expect(screen.getAllByLabelText('Message Prismo')).toHaveLength(1);
  expect(screen.queryByTestId('intent-bar')).toBeNull();
  expect(screen.getByLabelText('Dictate message')).toBeTruthy();
  expect(screen.getByLabelText('Talk to Prismo')).toBeTruthy();
});
it('opens settings both from the model chip and the menu', () => {
  mockEnabled = true;
  const screen = render(<AIAssistantScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Choose model and voice'));
  fireEvent.press(screen.getByText('Model settings'));
  fireEvent.press(screen.getByLabelText('More'));
  fireEvent.press(screen.getByText('Models & settings'));
  expect(screen.getByText('Model settings')).toBeTruthy();
  expect(screen.queryByText('Models & settings')).toBeNull();
});
it('hides the composer before setup but keeps model settings accessible', () => {
  const screen = render(<AIAssistantScreen navigation={navigation} />);
  expect(screen.queryByLabelText('Message Prismo')).toBeNull();
  expect(screen.queryByLabelText('Talk to Prismo')).toBeNull();
  fireEvent.press(screen.getByLabelText('More'));
  fireEvent.press(screen.getByText('Models & settings'));
  expect(screen.getByText('Model settings')).toBeTruthy();
});
it('opens the voice conversation when Agent is enabled', () => {
  mockEnabled = true;
  const screen = render(<AIAssistantScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Talk to Prismo'));
  expect(screen.getByText('Voice conversation')).toBeTruthy();
});
it('keeps clear chat visible after AI is turned off and asks before deleting', () => {
  mockEnabled = true;
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<AIAssistantScreen navigation={navigation} />);
  fireEvent.press(screen.getByText('Balance suggestion'));
  mockEnabled = false;
  screen.rerender(<AIAssistantScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Clear chat'));
  expect(alert).toHaveBeenCalledWith('Clear chat', expect.any(String), expect.arrayContaining([expect.objectContaining({ text: 'Cancel' })]));
  expect(screen.getByText('My balance')).toBeTruthy();
  alert.mockRestore();
});

it('opens labeled wallet actions and prepares an invoice draft without choosing an amount', () => {
  mockEnabled = true;
  const screen = render(<AIAssistantScreen navigation={navigation} />);
  fireEvent.press(screen.getByLabelText('Show quick actions'));
  expect(screen.getByText('Choose an amount to receive')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Invoice'));
  expect(screen.getByLabelText('Message Prismo').props.value).toBe('Create an invoice for ');
  expect(screen.queryByText('Wallet actions')).toBeNull();
  expect(screen.queryByText('Model settings')).toBeNull();
});

it('prioritizes send while drafting and restores Talk when the draft is cleared', () => {
  mockEnabled = true;
  const screen = render(<AIAssistantScreen navigation={navigation} />);
  fireEvent.changeText(screen.getByLabelText('Message Prismo'), 'Hello');
  expect(screen.getByLabelText('Send message')).toBeTruthy();
  expect(screen.queryByLabelText('Talk to Prismo')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Message Prismo'), '');
  expect(screen.getByLabelText('Talk to Prismo')).toBeTruthy();
  expect(screen.getByLabelText('Dictate message')).toBeTruthy();
});
