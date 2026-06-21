import {
  ReceiveOperationTimeoutError,
  callAbortableAdapterMethod,
  receiveMethodsSignature,
  runReceiveOperation,
  upsertReceiveMethod,
  type ReceiveMethod,
} from './receive-session';

const sparkMethod: ReceiveMethod = {
  key: 'spark',
  label: 'Spark',
  value: 'spark:one',
  protocol: 'SPARK',
  kind: 'address',
  layer: 'spark',
  monitor: 'balance',
  assetId: 'BTC',
};

describe('receive session helpers', () => {
  it('upserts a method without duplicating its key', () => {
    const updated = upsertReceiveMethod([sparkMethod], { ...sparkMethod, value: 'spark:two' });
    expect(updated).toHaveLength(1);
    expect(updated[0].value).toBe('spark:two');
  });

  it('builds a stable signature regardless of method order', () => {
    const lightning: ReceiveMethod = {
      ...sparkMethod,
      key: 'lightning',
      value: 'lnbc1',
      kind: 'invoice',
      layer: 'lightning',
      monitor: 'invoice',
    };
    expect(receiveMethodsSignature([sparkMethod, lightning]))
      .toBe(receiveMethodsSignature([lightning, sparkMethod]));
  });

  it('times out a slow adapter operation', async () => {
    jest.useFakeTimers();
    const result = runReceiveOperation(
      'slow operation',
      () => new Promise<string>(() => undefined),
      100,
    );
    jest.advanceTimersByTime(100);
    await expect(result).rejects.toBeInstanceOf(ReceiveOperationTimeoutError);
    jest.useRealTimers();
  });

  it('propagates cancellation to the adapter task', async () => {
    const controller = new AbortController();
    let taskSignal: AbortSignal | undefined;
    const result = runReceiveOperation(
      'cancelled operation',
      (signal) => {
        taskSignal = signal;
        return new Promise<string>(() => undefined);
      },
      1_000,
      controller.signal,
    );
    controller.abort(new Error('screen closed'));
    await expect(result).rejects.toThrow('screen closed');
    expect(taskSignal?.aborted).toBe(true);
  });

  it('prefers an adapter method that accepts an AbortSignal', async () => {
    const adapter = {
      getValue: jest.fn(async () => 'fallback'),
      getValueWithSignal: jest.fn(async (_key: string, signal: AbortSignal) =>
        signal.aborted ? 'cancelled' : 'abortable'),
    };
    const controller = new AbortController();
    await expect(
      callAbortableAdapterMethod<string>(adapter, 'getValue', ['key'], controller.signal),
    ).resolves.toBe('abortable');
    expect(adapter.getValue).not.toHaveBeenCalled();
  });
});
