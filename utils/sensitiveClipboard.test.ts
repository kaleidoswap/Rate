import { Clipboard } from 'react-native';
import { copySensitive } from './sensitiveClipboard';

jest.mock('react-native', () => ({ Clipboard: { setString: jest.fn() } }));

describe('copySensitive', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Clipboard.setString as jest.Mock).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('copies, then clears the clipboard after the TTL', () => {
    copySensitive('seed words', 1000);
    expect(Clipboard.setString).toHaveBeenLastCalledWith('seed words');
    jest.advanceTimersByTime(999);
    expect(Clipboard.setString).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(Clipboard.setString).toHaveBeenLastCalledWith('');
  });

  it('restarts the timer on a second copy', () => {
    copySensitive('one', 1000);
    jest.advanceTimersByTime(800);
    copySensitive('two', 1000);
    jest.advanceTimersByTime(800);
    expect(Clipboard.setString).toHaveBeenLastCalledWith('two');
    jest.advanceTimersByTime(200);
    expect(Clipboard.setString).toHaveBeenLastCalledWith('');
  });
});
