import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { WalletSetupPrompt } from './WalletSetupPrompt';

describe('wallet setup recovery', () => {
  it('offers creation and restore for a new wallet', () => {
    const onCreate = jest.fn();
    const onRestore = jest.fn();
    const screen = render(<WalletSetupPrompt hasExistingWallet={false} onCreate={onCreate} onRestore={onRestore} />);
    expect(screen.getByText('Set up your wallet')).toBeTruthy();
    fireEvent.press(screen.getByText('Create wallet'));
    fireEvent.press(screen.getByText('Restore wallet'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
  it('prioritizes recovery when an existing wallet has inaccessible keys', () => {
    const onRestore = jest.fn();
    const screen = render(<WalletSetupPrompt hasExistingWallet onCreate={jest.fn()} onRestore={onRestore} />);
    expect(screen.getByText('Restore your wallet')).toBeTruthy();
    fireEvent.press(screen.getByText('Restore wallet'));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
