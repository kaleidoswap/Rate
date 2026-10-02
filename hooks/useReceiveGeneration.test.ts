import { act, renderHook } from '@testing-library/react-native';
import { useReceiveGeneration } from './useReceiveGeneration';
const generate = jest.fn(), prepare = jest.fn(), invalidate = jest.fn();
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  (require('react-native') as any).InteractionManager = { runAfterInteractions: (callback: () => void) => { callback(); return { cancel: jest.fn() }; } };
});
afterEach(() => jest.useRealTimers());
test('creates one request and does not replace it after five seconds or routine rerenders', () => {
  const hook = renderHook(({ key }) => useReceiveGeneration(key, prepare, generate, invalidate), { initialProps: { key: 'BTC:1000' } });
  act(() => { jest.advanceTimersByTime(450); });
  expect(generate).toHaveBeenCalledTimes(1);
  hook.rerender({ key: 'BTC:1000' });
  act(() => { jest.advanceTimersByTime(60000); });
  expect(generate).toHaveBeenCalledTimes(1);
  hook.rerender({ key: 'BTC:2000' });
  act(() => { jest.advanceTimersByTime(450); });
  expect(generate).toHaveBeenCalledTimes(2);
  hook.unmount();
});
test('leaving Receive cancels a request that has not started', () => {
  const hook = renderHook(() => useReceiveGeneration('BTC', prepare, generate, invalidate));
  hook.unmount();
  act(() => { jest.runAllTimers(); });
  expect(generate).not.toHaveBeenCalled(); expect(invalidate).toHaveBeenCalledTimes(1);
});
test('explicit generation cancels the pending automatic generation', () => {
  const hook = renderHook(() => useReceiveGeneration('BTC', prepare, generate, invalidate));
  act(() => { hook.result.current.current(); });
  act(() => { jest.runAllTimers(); });
  expect(generate).not.toHaveBeenCalled(); hook.unmount();
});
