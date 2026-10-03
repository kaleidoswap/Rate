import { createRequestGuard } from './request-guard';

test('late invoice decoding cannot replace a newer recipient or clear its loading state', async () => {
  const guard = createRequestGuard();
  let finishOld!: (value: string) => void;
  const oldResult = new Promise<string>(resolve => { finishOld = resolve; });
  let recipient = '', loading = true;
  const oldIsCurrent = guard.begin();
  const oldTask = oldResult.then(value => {
    if (oldIsCurrent()) recipient = value;
  }).finally(() => { if (oldIsCurrent()) loading = false; });
  const newIsCurrent = guard.begin();
  recipient = 'new invoice';
  finishOld('old invoice'); await oldTask;
  expect(recipient).toBe('new invoice'); expect(loading).toBe(true);
  expect(newIsCurrent()).toBe(true);
});
test('leaving the screen or clearing an input invalidates pending work', () => {
  const guard = createRequestGuard();
  const active = guard.begin();
  guard.invalidate();
  expect(active()).toBe(false);
  expect(guard.begin()()).toBe(true);
});
