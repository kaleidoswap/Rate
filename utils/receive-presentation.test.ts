import { receivePresentation } from './receive-presentation';
test('expiration blocks idle and waiting requests but never overrides detected or settled payments', () => {
  expect(receivePresentation('watching', true)).toBe('expired');
  expect(receivePresentation('idle', false)).toBe('watching');
  expect(receivePresentation('pending', true)).toBe('pending');
  expect(receivePresentation('confirmed', true)).toBe('confirmed');
  expect(receivePresentation('claimed', true)).toBe('claimed');
  expect(receivePresentation('failed', true)).toBe('failed');
});
