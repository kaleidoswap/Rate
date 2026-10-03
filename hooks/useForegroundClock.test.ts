import { act, renderHook } from '@testing-library/react-native';
import { useForegroundClock } from './useForegroundClock';
let change: (state: string) => void;
const remove = jest.fn();
const originalAppState = (require('react-native') as any).AppState;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(10000); remove.mockClear();
  (require('react-native') as any).AppState = { currentState: 'active', addEventListener: (_: string, callback: typeof change) => { change = callback; return { remove }; } };
});
afterEach(() => { jest.useRealTimers(); (require('react-native') as any).AppState = originalAppState; });
test('pauses in the background and refreshes immediately on return', () => {
  const hook = renderHook(() => useForegroundClock());
  act(() => { jest.advanceTimersByTime(1000); });
  expect(hook.result.current).toBe(11000);
  act(() => { change('background'); jest.advanceTimersByTime(30000); });
  expect(hook.result.current).toBe(11000);
  act(() => { change('active'); });
  expect(hook.result.current).toBe(41000);
  hook.unmount(); expect(remove).toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
test('hidden consumers stop timers and refresh when enabled again', () => {
  const hook = renderHook(({ enabled }) => useForegroundClock(enabled), { initialProps: { enabled: true } });
  hook.rerender({ enabled: false });
  expect(jest.getTimerCount()).toBe(0);
  act(() => { jest.advanceTimersByTime(10000); });
  hook.rerender({ enabled: true });
  expect(hook.result.current).toBe(20000);
  hook.unmount(); expect(jest.getTimerCount()).toBe(0);
});
