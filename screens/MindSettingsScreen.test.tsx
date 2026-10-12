import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import MindSettingsScreen from './MindSettingsScreen';
import { DEFAULT_MIND_CONFIG, setMindConfig } from '../store/slices/settingsSlice';
const mockDispatch = jest.fn();
jest.mock('../store/hooks', () => ({ useAppDispatch: () => mockDispatch, useAppSelector: () => require('../store/slices/settingsSlice').DEFAULT_MIND_CONFIG }));
jest.mock('../components', () => ({ ScreenHeader: () => null }));
jest.mock('../components/Sheet', () => ({ Sheet: () => null }));
jest.mock('../services/mindAgent', () => ({ clearMindMemory: jest.fn() }));
jest.mock('@kaleidorg/mind', () => ({ skillsFromBundle: () => [] }));
beforeEach(() => mockDispatch.mockClear());
it('saves personality as it is edited without requiring a blur event', () => {
  const screen = render(<MindSettingsScreen />);
  fireEvent.changeText(screen.getByDisplayValue(DEFAULT_MIND_CONFIG.persona), 'Keep answers short.');
  expect(mockDispatch).toHaveBeenCalledWith(setMindConfig({ persona: 'Keep answers short.' }));
});
it('keeps technical controls collapsed until requested', () => {
  const screen = render(<MindSettingsScreen />);
  expect(screen.queryByText('Knowledge base (RAG)')).toBeNull();
  fireEvent.press(screen.getByText('Context & memory'));
  expect(screen.getByText('Knowledge base (RAG)')).toBeTruthy();
  expect(screen.queryByText('Add MCP server')).toBeNull();
  fireEvent.press(screen.getByText('Connected tools'));
  expect(screen.getByText('Add MCP server')).toBeTruthy();
});
