import React from 'react';
import { render } from '@testing-library/react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { useScreenCaptureProtection } from './useScreenCaptureProtection';

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(() => Promise.resolve()),
  allowScreenCaptureAsync: jest.fn(() => Promise.resolve()),
  enableAppSwitcherProtectionAsync: jest.fn(() => Promise.resolve()),
  disableAppSwitcherProtectionAsync: jest.fn(() => Promise.resolve()),
}));

function Probe({ active }: { active: boolean }) {
  useScreenCaptureProtection(active);
  return null;
}

describe('useScreenCaptureProtection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing while inactive', () => {
    render(<Probe active={false} />);
    expect(ScreenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it('blocks capture while active and restores it with the same key', () => {
    const view = render(<Probe active />);
    const key = (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mock.calls[0][0];
    view.rerender(<Probe active={false} />);
    expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalledWith(key);
  });

  it('restores capture on unmount', () => {
    const view = render(<Probe active />);
    view.unmount();
    expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalled();
  });
});
